use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};
use std::time::Duration;

use russh::{client, ChannelMsg, Sig};
use tokio::sync::Mutex as AsyncMutex;

use crate::{
    ssh_channel::StartupChannelCloseGuard,
    ssh_connection::SshConnection,
    utils::{catch_foreign_callback_unwind, now_ms, SshError, CLOSE_TIMEOUT},
};

const DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES: u64 = 1024 * 1024;
const MAX_RUN_COMMAND_MAX_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_EXEC_REQUEST_BUFFERED_MESSAGES: usize = 256;
const EXEC_REQUEST_REPLY_TIMEOUT: Duration = Duration::from_secs(5);

type CommandWriter = AsyncMutex<russh::ChannelWriteHalf<client::Msg>>;

#[uniffi::export]
pub fn default_run_command_max_output_bytes() -> u64 {
    DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES
}

#[uniffi::export]
pub fn max_run_command_max_output_bytes() -> u64 {
    MAX_RUN_COMMAND_MAX_OUTPUT_BYTES
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RunCommandOptions {
    pub command: String,
    pub max_output_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CommandOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_status: Option<u32>,
    pub exit_signal: Option<String>,
}

#[derive(Clone, uniffi::Record)]
pub struct StartCommandStreamOptions {
    pub command: String,
    pub on_event_callback: Arc<dyn CommandStreamCallback>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum CommandStreamEvent {
    Stdout { bytes: Vec<u8> },
    Stderr { bytes: Vec<u8> },
    ExitStatus { exit_status: u32 },
    ExitSignal { signal_name: String },
    Closed,
}

#[uniffi::export(with_foreign)]
pub trait CommandStreamCallback: Send + Sync {
    fn on_event(&self, event: CommandStreamEvent);
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CommandStreamInfo {
    pub channel_id: u32,
    pub created_at_ms: f64,
    pub connection_id: String,
}

#[derive(Default)]
pub(crate) struct CommandOutputCollector {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_status: Option<u32>,
    exit_signal: Option<String>,
}

impl CommandOutputCollector {
    pub(crate) fn record_stdout(&mut self, bytes: &[u8]) {
        self.stdout.extend_from_slice(bytes);
    }

    pub(crate) fn record_stderr(&mut self, bytes: &[u8]) {
        self.stderr.extend_from_slice(bytes);
    }

    pub(crate) fn record_exit_status(&mut self, exit_status: u32) {
        self.exit_status = Some(exit_status);
    }

    pub(crate) fn record_exit_signal(&mut self, signal_name: String) {
        self.exit_signal = Some(signal_name);
    }

    pub(crate) fn finish(self) -> CommandOutput {
        CommandOutput {
            stdout: self.stdout,
            stderr: self.stderr,
            exit_status: self.exit_status,
            exit_signal: self.exit_signal,
        }
    }
}

#[derive(uniffi::Object)]
pub struct CommandStreamSession {
    pub info: CommandStreamInfo,
    parent: Weak<SshConnection>,
    writer: Arc<CommandWriter>,
    reader_task: tokio::task::JoinHandle<()>,
    rt_handle: tokio::runtime::Handle,
}

#[uniffi::export(async_runtime = "tokio")]
impl CommandStreamSession {
    pub fn get_info(&self) -> CommandStreamInfo {
        self.info.clone()
    }

    pub async fn close(&self) -> Result<(), SshError> {
        self.close_internal().await
    }
}

impl CommandStreamSession {
    async fn close_internal(&self) -> Result<(), SshError> {
        self.reader_task.abort();
        if let Some(parent) = self.parent.upgrade() {
            parent
                .command_streams
                .lock()
                .await
                .remove(&self.info.channel_id);
        }
        close_command_writer_best_effort(&self.writer).await;
        Ok(())
    }
}

async fn close_command_writer_best_effort(writer: &CommandWriter) {
    tokio::time::timeout(CLOSE_TIMEOUT, async {
        writer.lock().await.close().await.ok();
    })
    .await
    .ok();
}

impl Drop for CommandStreamSession {
    fn drop(&mut self) {
        self.reader_task.abort();
        let parent = self.parent.clone();
        let writer = self.writer.clone();
        let channel_id = self.info.channel_id;
        self.rt_handle.spawn(async move {
            if let Some(parent) = parent.upgrade() {
                parent.command_streams.lock().await.remove(&channel_id);
            }
            close_command_writer_best_effort(&writer).await;
        });
    }
}

fn signal_name_to_string(signal_name: Sig) -> String {
    match signal_name {
        Sig::ABRT => "ABRT".to_string(),
        Sig::ALRM => "ALRM".to_string(),
        Sig::FPE => "FPE".to_string(),
        Sig::HUP => "HUP".to_string(),
        Sig::ILL => "ILL".to_string(),
        Sig::INT => "INT".to_string(),
        Sig::KILL => "KILL".to_string(),
        Sig::PIPE => "PIPE".to_string(),
        Sig::QUIT => "QUIT".to_string(),
        Sig::SEGV => "SEGV".to_string(),
        Sig::TERM => "TERM".to_string(),
        Sig::USR1 => "USR1".to_string(),
        Sig::Custom(value) => value,
    }
}

fn command_stream_message_finishes_reader(message: Option<&ChannelMsg>) -> bool {
    matches!(message, Some(ChannelMsg::Close) | None)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CommandStreamReaderEffects {
    close_writer: bool,
    emit_closed: bool,
    remove_session: bool,
    stop_reader: bool,
}

fn command_stream_reader_effects(
    message_finishes_reader: bool,
    callback_dispatched: bool,
) -> CommandStreamReaderEffects {
    if !callback_dispatched {
        return CommandStreamReaderEffects {
            close_writer: true,
            emit_closed: false,
            remove_session: true,
            stop_reader: true,
        };
    }

    if message_finishes_reader {
        return CommandStreamReaderEffects {
            close_writer: false,
            emit_closed: true,
            remove_session: true,
            stop_reader: true,
        };
    }

    CommandStreamReaderEffects {
        close_writer: false,
        emit_closed: false,
        remove_session: false,
        stop_reader: false,
    }
}

struct AcceptedExecStartup {
    buffered_messages: Vec<ChannelMsg>,
}

impl AcceptedExecStartup {
    fn new(buffered_messages: Vec<ChannelMsg>) -> Self {
        Self { buffered_messages }
    }

    fn complete_after_eof(
        self,
        eof_result: Result<(), SshError>,
    ) -> Result<CompletedExecStartup, SshError> {
        eof_result?;
        Ok(CompletedExecStartup {
            buffered_messages: self.buffered_messages,
        })
    }
}

#[derive(Debug)]
struct CompletedExecStartup {
    buffered_messages: Vec<ChannelMsg>,
}

impl CompletedExecStartup {
    fn into_buffered_messages(self) -> Vec<ChannelMsg> {
        self.buffered_messages
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExecRequestReply {
    Success,
    Failure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExecRequestMessageDecision {
    Continue,
    Success,
    Failure,
    ClosedBeforeSuccess,
}

fn classify_exec_request_reply(message: &ChannelMsg) -> Option<ExecRequestReply> {
    match message {
        ChannelMsg::Success => Some(ExecRequestReply::Success),
        ChannelMsg::Failure => Some(ExecRequestReply::Failure),
        _ => None,
    }
}

async fn open_command_session(
    connection: &SshConnection,
) -> Result<russh::Channel<client::Msg>, SshError> {
    match tokio::time::timeout(EXEC_REQUEST_REPLY_TIMEOUT, async {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await
    })
    .await
    {
        Ok(Ok(channel)) => Ok(channel),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            connection.disconnect().await.ok();
            Err(SshError::Russh(
                "SSH command channel open timed out".to_string(),
            ))
        }
    }
}

async fn send_command_exec(
    channel: &russh::Channel<client::Msg>,
    command: String,
) -> Result<(), SshError> {
    match tokio::time::timeout(EXEC_REQUEST_REPLY_TIMEOUT, channel.exec(true, command)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Err(SshError::Russh(
            "SSH exec request send timed out".to_string(),
        )),
    }
}

async fn send_command_eof(channel: &russh::Channel<client::Msg>) -> Result<(), SshError> {
    match tokio::time::timeout(CLOSE_TIMEOUT, channel.eof()).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Err(SshError::Russh(
            "SSH command EOF send timed out".to_string(),
        )),
    }
}

async fn wait_for_exec_request_success(
    channel: &mut russh::Channel<client::Msg>,
    max_buffer_bytes: usize,
) -> Result<Vec<ChannelMsg>, SshError> {
    let mut buffered_messages = Vec::new();
    let mut buffered_output_bytes = 0usize;
    let deadline = tokio::time::Instant::now() + EXEC_REQUEST_REPLY_TIMEOUT;

    loop {
        let message = match tokio::time::timeout_at(deadline, channel.wait()).await {
            Ok(Some(message)) => message,
            Ok(None) => {
                return Err(SshError::Russh(
                    "SSH exec request closed before success".to_string(),
                ));
            }
            Err(_) => {
                return Err(SshError::Russh(
                    "SSH exec request timed out before success".to_string(),
                ));
            }
        };

        match record_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            message,
            max_buffer_bytes,
        )? {
            ExecRequestMessageDecision::Continue => {}
            ExecRequestMessageDecision::Success => return Ok(buffered_messages),
            ExecRequestMessageDecision::Failure => {
                return Err(SshError::Russh("SSH exec request failed".to_string()));
            }
            ExecRequestMessageDecision::ClosedBeforeSuccess => {
                return Err(SshError::Russh(
                    "SSH exec request closed before success".to_string(),
                ));
            }
        }
    }
}

async fn finish_accepted_exec_startup(
    channel_guard: &mut StartupChannelCloseGuard,
    max_buffer_bytes: usize,
) -> Result<CompletedExecStartup, SshError> {
    let accepted = AcceptedExecStartup::new(
        wait_for_exec_request_success(channel_guard.channel_mut(), max_buffer_bytes).await?,
    );
    accepted.complete_after_eof(send_command_eof(channel_guard.channel()).await)
}

fn record_exec_request_message(
    buffered_messages: &mut Vec<ChannelMsg>,
    buffered_output_bytes: &mut usize,
    message: ChannelMsg,
    max_buffer_bytes: usize,
) -> Result<ExecRequestMessageDecision, SshError> {
    match classify_exec_request_reply(&message) {
        Some(ExecRequestReply::Success) => Ok(ExecRequestMessageDecision::Success),
        Some(ExecRequestReply::Failure) => Ok(ExecRequestMessageDecision::Failure),
        None if command_stream_message_finishes_reader(Some(&message))
            || matches!(message, ChannelMsg::Eof) =>
        {
            Ok(ExecRequestMessageDecision::ClosedBeforeSuccess)
        }
        None => {
            buffer_exec_request_message(
                buffered_messages,
                buffered_output_bytes,
                message,
                max_buffer_bytes,
            )?;
            Ok(ExecRequestMessageDecision::Continue)
        }
    }
}

fn buffer_exec_request_message(
    buffered_messages: &mut Vec<ChannelMsg>,
    buffered_output_bytes: &mut usize,
    message: ChannelMsg,
    max_buffer_bytes: usize,
) -> Result<(), SshError> {
    if buffered_messages.len() >= MAX_EXEC_REQUEST_BUFFERED_MESSAGES {
        return Err(SshError::Russh(format!(
            "SSH exec request buffered more than {MAX_EXEC_REQUEST_BUFFERED_MESSAGES} startup messages"
        )));
    }

    let incoming_bytes = match &message {
        ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => data.len(),
        _ => 0,
    };

    if incoming_bytes > max_buffer_bytes.saturating_sub(*buffered_output_bytes) {
        return Err(SshError::Russh(format!(
            "SSH exec request startup output exceeded limit of {max_buffer_bytes} bytes"
        )));
    }

    *buffered_output_bytes = buffered_output_bytes.saturating_add(incoming_bytes);
    buffered_messages.push(message);
    Ok(())
}

fn record_command_output_message(
    collector: &mut CommandOutputCollector,
    message: ChannelMsg,
    max_output_bytes: usize,
) -> Result<bool, SshError> {
    match message {
        ChannelMsg::Data { data } => {
            ensure_command_output_capacity(collector, data.len(), max_output_bytes)?;
            collector.record_stdout(&data);
        }
        ChannelMsg::ExtendedData { data, .. } => {
            ensure_command_output_capacity(collector, data.len(), max_output_bytes)?;
            collector.record_stderr(&data);
        }
        ChannelMsg::ExitStatus { exit_status } => {
            collector.record_exit_status(exit_status);
        }
        ChannelMsg::ExitSignal { signal_name, .. } => {
            collector.record_exit_signal(signal_name_to_string(signal_name));
        }
        ChannelMsg::Close => return Ok(true),
        ChannelMsg::Eof => {}
        _ => {}
    }
    Ok(false)
}

fn ensure_command_output_capacity(
    collector: &CommandOutputCollector,
    incoming_bytes: usize,
    max_output_bytes: usize,
) -> Result<(), SshError> {
    let current_bytes = collector
        .stdout
        .len()
        .saturating_add(collector.stderr.len());
    if incoming_bytes > max_output_bytes.saturating_sub(current_bytes) {
        return Err(SshError::Russh(format!(
            "SSH command output exceeded limit of {max_output_bytes} bytes"
        )));
    }
    Ok(())
}

fn max_output_bytes_for_options(options: &RunCommandOptions) -> Result<usize, SshError> {
    let max_output_bytes = options
        .max_output_bytes
        .unwrap_or(DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES);

    if max_output_bytes == 0 {
        return Err(SshError::Russh(
            "SSH command max_output_bytes must be greater than 0".to_string(),
        ));
    }
    if max_output_bytes > MAX_RUN_COMMAND_MAX_OUTPUT_BYTES {
        return Err(SshError::Russh(format!(
            "SSH command max_output_bytes must be at most {MAX_RUN_COMMAND_MAX_OUTPUT_BYTES} bytes"
        )));
    }

    Ok(max_output_bytes as usize)
}

fn emit_command_stream_event(
    callback: &Arc<dyn CommandStreamCallback>,
    event: CommandStreamEvent,
) -> bool {
    catch_foreign_callback_unwind(|| callback.on_event(event))
}

fn dispatch_command_stream_message(
    callback: &Arc<dyn CommandStreamCallback>,
    message: ChannelMsg,
) -> bool {
    match message {
        ChannelMsg::Data { data } => emit_command_stream_event(
            callback,
            CommandStreamEvent::Stdout {
                bytes: data.to_vec(),
            },
        ),
        ChannelMsg::ExtendedData { data, .. } => emit_command_stream_event(
            callback,
            CommandStreamEvent::Stderr {
                bytes: data.to_vec(),
            },
        ),
        ChannelMsg::ExitStatus { exit_status } => {
            emit_command_stream_event(callback, CommandStreamEvent::ExitStatus { exit_status })
        }
        ChannelMsg::ExitSignal { signal_name, .. } => emit_command_stream_event(
            callback,
            CommandStreamEvent::ExitSignal {
                signal_name: signal_name_to_string(signal_name),
            },
        ),
        ChannelMsg::Eof => true,
        _ => true,
    }
}

pub(crate) async fn run_command(
    connection: &SshConnection,
    options: RunCommandOptions,
) -> Result<CommandOutput, SshError> {
    let max_output_bytes = max_output_bytes_for_options(&options)?;
    let channel = open_command_session(connection).await?;
    let mut channel_guard = StartupChannelCloseGuard::new(channel);
    send_command_exec(channel_guard.channel(), options.command).await?;
    let buffered_messages = finish_accepted_exec_startup(&mut channel_guard, max_output_bytes)
        .await?
        .into_buffered_messages();

    let mut collector = CommandOutputCollector::default();
    let mut is_closed = false;

    for message in buffered_messages {
        if record_command_output_message(&mut collector, message, max_output_bytes)? {
            is_closed = true;
            break;
        }
    }

    while !is_closed {
        let Some(message) = channel_guard.channel_mut().wait().await else {
            break;
        };
        if record_command_output_message(&mut collector, message, max_output_bytes)? {
            is_closed = true;
        }
    }

    channel_guard.close().await;
    Ok(collector.finish())
}

pub(crate) async fn start_command_stream(
    connection: &SshConnection,
    options: StartCommandStreamOptions,
) -> Result<Arc<CommandStreamSession>, SshError> {
    let started_at_ms = now_ms();
    let channel = open_command_session(connection).await?;
    let mut channel_guard = StartupChannelCloseGuard::new(channel);
    let channel_id: u32 = channel_guard.channel().id().into();
    send_command_exec(channel_guard.channel(), options.command).await?;
    let buffered_messages = finish_accepted_exec_startup(
        &mut channel_guard,
        DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES as usize,
    )
    .await?
    .into_buffered_messages();
    let callback = options.on_event_callback.clone();
    let parent = connection.self_weak.lock().await.clone();
    let mut command_streams = connection.command_streams.lock().await;
    let parent_for_reader = parent.clone();
    let reader_has_closed = Arc::new(AtomicBool::new(false));
    let reader_has_closed_for_reader = reader_has_closed.clone();

    let channel = channel_guard.into_inner();
    let (mut reader, writer) = channel.split();
    let writer = Arc::new(AsyncMutex::new(writer));
    let writer_for_reader = writer.clone();

    let reader_task = tokio::spawn(async move {
        for message in buffered_messages {
            let effects = command_stream_reader_effects(
                false,
                dispatch_command_stream_message(&callback, message),
            );
            if effects.stop_reader {
                reader_has_closed_for_reader.store(true, Ordering::Release);
                if effects.close_writer {
                    close_command_writer_best_effort(&writer_for_reader).await;
                }
                if effects.remove_session {
                    if let Some(parent) = parent_for_reader.upgrade() {
                        parent.command_streams.lock().await.remove(&channel_id);
                    }
                }
                return;
            }
        }

        loop {
            let message = reader.wait().await;
            let message_finishes_reader = command_stream_message_finishes_reader(message.as_ref());
            let callback_dispatched = if message_finishes_reader {
                true
            } else if let Some(message) = message {
                dispatch_command_stream_message(&callback, message)
            } else {
                true
            };
            let effects =
                command_stream_reader_effects(message_finishes_reader, callback_dispatched);

            if effects.emit_closed {
                emit_command_stream_event(&callback, CommandStreamEvent::Closed);
            }
            if effects.close_writer {
                close_command_writer_best_effort(&writer_for_reader).await;
            }
            if effects.remove_session {
                if let Some(parent) = parent_for_reader.upgrade() {
                    parent.command_streams.lock().await.remove(&channel_id);
                }
            }
            if effects.stop_reader {
                reader_has_closed_for_reader.store(true, Ordering::Release);
                break;
            }
        }
    });

    let session = Arc::new(CommandStreamSession {
        info: CommandStreamInfo {
            channel_id,
            created_at_ms: started_at_ms,
            connection_id: connection.info.connection_id.clone(),
        },
        parent,
        writer,
        reader_task,
        rt_handle: tokio::runtime::Handle::current(),
    });

    command_streams.insert(channel_id, Arc::downgrade(&session));
    // The reader can observe a fast remote close before this insertion happens.
    // Remove the just-inserted session if that close already won the race.
    if reader_has_closed.load(Ordering::Acquire) {
        command_streams.remove(&channel_id);
    }

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::CryptoVec;

    #[derive(Default)]
    struct RecordingCommandStreamCallback {
        events: std::sync::Mutex<Vec<CommandStreamEvent>>,
    }

    impl RecordingCommandStreamCallback {
        fn events(&self) -> Vec<CommandStreamEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl CommandStreamCallback for RecordingCommandStreamCallback {
        fn on_event(&self, event: CommandStreamEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    struct PanickingCommandStreamCallback;

    impl CommandStreamCallback for PanickingCommandStreamCallback {
        fn on_event(&self, _event: CommandStreamEvent) {
            panic!("callback panic");
        }
    }

    #[test]
    fn command_output_collector_separates_streams_and_exit_status() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"hello\n");
        collector.record_stderr(b"warn\n");
        collector.record_exit_status(7);

        let output = collector.finish();

        assert_eq!(output.stdout, b"hello\n");
        assert_eq!(output.stderr, b"warn\n");
        assert_eq!(output.exit_status, Some(7));
        assert_eq!(output.exit_signal, None);
    }

    #[test]
    fn command_output_collector_preserves_exit_signal() {
        let mut collector = CommandOutputCollector::default();

        collector.record_stdout(b"before\n");
        collector.record_exit_signal("TERM".to_string());

        let output = collector.finish();

        assert_eq!(output.stdout, b"before\n");
        assert_eq!(output.stderr, b"");
        assert_eq!(output.exit_status, None);
        assert_eq!(output.exit_signal, Some("TERM".to_string()));
    }

    #[test]
    fn command_stream_reader_removes_session_on_final_close_only() {
        assert!(!command_stream_message_finishes_reader(Some(
            &ChannelMsg::Eof
        )));
        assert!(command_stream_message_finishes_reader(Some(
            &ChannelMsg::Close
        )));
        assert!(command_stream_message_finishes_reader(None));
    }

    #[test]
    fn command_stream_reader_effects_keep_eof_non_final() {
        let effects = command_stream_reader_effects(
            command_stream_message_finishes_reader(Some(&ChannelMsg::Eof)),
            true,
        );

        assert_eq!(
            effects,
            CommandStreamReaderEffects {
                close_writer: false,
                emit_closed: false,
                remove_session: false,
                stop_reader: false,
            }
        );
    }

    #[test]
    fn command_stream_reader_effects_close_on_final_channel_end() {
        let close = ChannelMsg::Close;
        for message in [Some(&close), None] {
            let effects = command_stream_reader_effects(
                command_stream_message_finishes_reader(message),
                true,
            );

            assert_eq!(
                effects,
                CommandStreamReaderEffects {
                    close_writer: false,
                    emit_closed: true,
                    remove_session: true,
                    stop_reader: true,
                }
            );
        }
    }

    #[test]
    fn command_stream_reader_effects_close_writer_on_callback_panic() {
        let effects = command_stream_reader_effects(false, false);

        assert_eq!(
            effects,
            CommandStreamReaderEffects {
                close_writer: true,
                emit_closed: false,
                remove_session: true,
                stop_reader: true,
            }
        );
    }

    #[test]
    fn accepted_exec_startup_requires_successful_eof_before_completion() {
        let completed = AcceptedExecStartup::new(vec![ChannelMsg::WindowAdjusted { new_size: 1 }])
            .complete_after_eof(Ok(()))
            .unwrap();
        assert_eq!(completed.into_buffered_messages().len(), 1);

        let error = AcceptedExecStartup::new(Vec::new())
            .complete_after_eof(Err(SshError::Russh(
                "SSH command EOF send timed out".to_string(),
            )))
            .unwrap_err();
        match error {
            SshError::Russh(message) => assert!(message.contains("EOF send timed out")),
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
    }

    #[test]
    fn record_command_output_message_maps_channel_messages() {
        let mut collector = CommandOutputCollector::default();

        let stdout_closed = record_command_output_message(
            &mut collector,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"out"),
            },
            16,
        )
        .unwrap();
        let stderr_closed = record_command_output_message(
            &mut collector,
            ChannelMsg::ExtendedData {
                data: CryptoVec::from_slice(b"err"),
                ext: 1,
            },
            16,
        )
        .unwrap();
        let status_closed = record_command_output_message(
            &mut collector,
            ChannelMsg::ExitStatus { exit_status: 12 },
            16,
        )
        .unwrap();
        let signal_closed = record_command_output_message(
            &mut collector,
            ChannelMsg::ExitSignal {
                signal_name: Sig::TERM,
                core_dumped: false,
                error_message: String::new(),
                lang_tag: String::new(),
            },
            16,
        )
        .unwrap();
        let eof_closed =
            record_command_output_message(&mut collector, ChannelMsg::Eof, 16).unwrap();
        let close_closed =
            record_command_output_message(&mut collector, ChannelMsg::Close, 16).unwrap();

        let output = collector.finish();

        assert!(!stdout_closed);
        assert!(!stderr_closed);
        assert!(!status_closed);
        assert!(!signal_closed);
        assert!(!eof_closed);
        assert!(close_closed);
        assert_eq!(output.stdout, b"out");
        assert_eq!(output.stderr, b"err");
        assert_eq!(output.exit_status, Some(12));
        assert_eq!(output.exit_signal, Some("TERM".to_string()));
    }

    #[test]
    fn record_command_output_message_enforces_combined_output_cap() {
        let mut collector = CommandOutputCollector::default();

        record_command_output_message(
            &mut collector,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"abc"),
            },
            5,
        )
        .unwrap();

        let error = record_command_output_message(
            &mut collector,
            ChannelMsg::ExtendedData {
                data: CryptoVec::from_slice(b"def"),
                ext: 1,
            },
            5,
        )
        .unwrap_err();

        match error {
            SshError::Russh(message) => {
                assert!(message.contains("SSH command output exceeded"));
            }
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
    }

    #[test]
    fn max_output_bytes_uses_default_and_accepts_valid_override() {
        assert_eq!(
            max_output_bytes_for_options(&RunCommandOptions {
                command: "true".to_string(),
                max_output_bytes: None,
            })
            .unwrap(),
            DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES as usize
        );
        assert_eq!(
            max_output_bytes_for_options(&RunCommandOptions {
                command: "true".to_string(),
                max_output_bytes: Some(4096),
            })
            .unwrap(),
            4096
        );
    }

    #[test]
    fn max_output_byte_contract_constants_are_exported() {
        assert_eq!(
            default_run_command_max_output_bytes(),
            DEFAULT_RUN_COMMAND_MAX_OUTPUT_BYTES
        );
        assert_eq!(
            max_run_command_max_output_bytes(),
            MAX_RUN_COMMAND_MAX_OUTPUT_BYTES
        );
    }

    #[test]
    fn max_output_bytes_rejects_zero_and_oversized_override() {
        let zero = max_output_bytes_for_options(&RunCommandOptions {
            command: "true".to_string(),
            max_output_bytes: Some(0),
        })
        .unwrap_err();
        let oversized = max_output_bytes_for_options(&RunCommandOptions {
            command: "true".to_string(),
            max_output_bytes: Some(MAX_RUN_COMMAND_MAX_OUTPUT_BYTES + 1),
        })
        .unwrap_err();

        match zero {
            SshError::Russh(message) => assert!(message.contains("greater than 0")),
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
        match oversized {
            SshError::Russh(message) => assert!(message.contains("at most")),
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
    }

    #[test]
    fn buffer_exec_request_message_enforces_startup_output_cap() {
        let mut buffered_messages = Vec::new();
        let mut buffered_output_bytes = 0usize;

        buffer_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"abc"),
            },
            5,
        )
        .unwrap();

        let error = buffer_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            ChannelMsg::ExtendedData {
                data: CryptoVec::from_slice(b"def"),
                ext: 1,
            },
            5,
        )
        .unwrap_err();

        assert_eq!(buffered_messages.len(), 1);
        assert_eq!(buffered_output_bytes, 3);
        match error {
            SshError::Russh(message) => assert!(message.contains("startup output exceeded")),
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
    }

    #[test]
    fn buffer_exec_request_message_enforces_startup_message_count_cap() {
        let mut buffered_messages = Vec::new();
        let mut buffered_output_bytes = 0usize;

        for _ in 0..MAX_EXEC_REQUEST_BUFFERED_MESSAGES {
            buffer_exec_request_message(
                &mut buffered_messages,
                &mut buffered_output_bytes,
                ChannelMsg::WindowAdjusted { new_size: 1 },
                5,
            )
            .unwrap();
        }

        let error = buffer_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            ChannelMsg::WindowAdjusted { new_size: 1 },
            5,
        )
        .unwrap_err();

        match error {
            SshError::Russh(message) => assert!(message.contains("buffered more than")),
            other => panic!("expected SshError::Russh, got {other:?}"),
        }
    }

    #[test]
    fn record_exec_request_message_buffers_until_success() {
        let mut buffered_messages = Vec::new();
        let mut buffered_output_bytes = 0usize;

        let decision = record_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"pre"),
            },
            16,
        )
        .unwrap();
        assert_eq!(decision, ExecRequestMessageDecision::Continue);

        let decision = record_exec_request_message(
            &mut buffered_messages,
            &mut buffered_output_bytes,
            ChannelMsg::Success,
            16,
        )
        .unwrap();

        assert_eq!(decision, ExecRequestMessageDecision::Success);
        assert_eq!(buffered_messages.len(), 1);
        assert_eq!(buffered_output_bytes, 3);
    }

    #[test]
    fn record_exec_request_message_classifies_failure_and_early_close() {
        let mut buffered_messages = Vec::new();
        let mut buffered_output_bytes = 0usize;

        assert_eq!(
            record_exec_request_message(
                &mut buffered_messages,
                &mut buffered_output_bytes,
                ChannelMsg::Failure,
                16,
            )
            .unwrap(),
            ExecRequestMessageDecision::Failure
        );
        assert_eq!(
            record_exec_request_message(
                &mut buffered_messages,
                &mut buffered_output_bytes,
                ChannelMsg::Close,
                16,
            )
            .unwrap(),
            ExecRequestMessageDecision::ClosedBeforeSuccess
        );
        assert_eq!(
            record_exec_request_message(
                &mut buffered_messages,
                &mut buffered_output_bytes,
                ChannelMsg::Eof,
                16,
            )
            .unwrap(),
            ExecRequestMessageDecision::ClosedBeforeSuccess
        );
    }

    #[test]
    fn dispatch_command_stream_message_maps_channel_messages_to_events() {
        let recorder = Arc::new(RecordingCommandStreamCallback::default());
        let callback: Arc<dyn CommandStreamCallback> = recorder.clone();

        assert!(dispatch_command_stream_message(
            &callback,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"out"),
            },
        ));
        assert!(dispatch_command_stream_message(
            &callback,
            ChannelMsg::ExtendedData {
                data: CryptoVec::from_slice(b"err"),
                ext: 1,
            },
        ));
        assert!(dispatch_command_stream_message(
            &callback,
            ChannelMsg::ExitStatus { exit_status: 3 }
        ));
        assert!(dispatch_command_stream_message(
            &callback,
            ChannelMsg::ExitSignal {
                signal_name: Sig::TERM,
                core_dumped: false,
                error_message: String::new(),
                lang_tag: String::new(),
            },
        ));
        assert!(dispatch_command_stream_message(&callback, ChannelMsg::Eof));

        assert_eq!(
            recorder.events(),
            vec![
                CommandStreamEvent::Stdout {
                    bytes: b"out".to_vec()
                },
                CommandStreamEvent::Stderr {
                    bytes: b"err".to_vec()
                },
                CommandStreamEvent::ExitStatus { exit_status: 3 },
                CommandStreamEvent::ExitSignal {
                    signal_name: "TERM".to_string()
                },
            ]
        );
    }

    #[test]
    fn safe_emit_command_stream_event_catches_callback_panic() {
        let callback: Arc<dyn CommandStreamCallback> = Arc::new(PanickingCommandStreamCallback);

        assert!(!emit_command_stream_event(
            &callback,
            CommandStreamEvent::Closed
        ));
    }

    #[test]
    fn dispatch_command_stream_message_reports_callback_panic() {
        let callback: Arc<dyn CommandStreamCallback> = Arc::new(PanickingCommandStreamCallback);

        assert!(!dispatch_command_stream_message(
            &callback,
            ChannelMsg::Data {
                data: CryptoVec::from_slice(b"out"),
            },
        ));
    }

    #[test]
    fn exec_request_reply_classifies_success_and_failure_only() {
        assert_eq!(
            classify_exec_request_reply(&ChannelMsg::Success),
            Some(ExecRequestReply::Success)
        );
        assert_eq!(
            classify_exec_request_reply(&ChannelMsg::Failure),
            Some(ExecRequestReply::Failure)
        );
        assert_eq!(classify_exec_request_reply(&ChannelMsg::Eof), None);
    }
}
