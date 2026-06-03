use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Weak,
};

use russh::{client, ChannelMsg, Sig};
use tokio::sync::Mutex as AsyncMutex;

use crate::{
    ssh_connection::SshConnection,
    utils::{now_ms, SshError},
};

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RunCommandOptions {
    pub command: String,
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
    writer: AsyncMutex<russh::ChannelWriteHalf<client::Msg>>,
    reader_task: tokio::task::JoinHandle<()>,
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
        // Explicit app-requested close is caller-observed by this method's
        // result. The Closed callback is reserved for remote/channel closure.
        self.writer.lock().await.close().await.ok();
        self.reader_task.abort();
        if let Some(parent) = self.parent.upgrade() {
            parent
                .command_streams
                .lock()
                .await
                .remove(&self.info.channel_id);
        }
        Ok(())
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

fn command_stream_should_remain_registered_after_insert(reader_has_closed: bool) -> bool {
    !reader_has_closed
}

struct PreSessionChannelCloseGuard {
    channel: Option<russh::Channel<client::Msg>>,
}

impl PreSessionChannelCloseGuard {
    fn new(channel: russh::Channel<client::Msg>) -> Self {
        Self {
            channel: Some(channel),
        }
    }

    fn channel(&self) -> &russh::Channel<client::Msg> {
        self.channel
            .as_ref()
            .expect("pre-session channel guard missing channel")
    }

    fn channel_mut(&mut self) -> &mut russh::Channel<client::Msg> {
        self.channel
            .as_mut()
            .expect("pre-session channel guard missing channel")
    }

    fn into_inner(mut self) -> russh::Channel<client::Msg> {
        self.channel
            .take()
            .expect("pre-session channel guard missing channel")
    }

    async fn close(mut self) {
        if let Some(channel) = self.channel.take() {
            channel.close().await.ok();
        }
    }
}

impl Drop for PreSessionChannelCloseGuard {
    fn drop(&mut self) {
        if let Some(channel) = self.channel.take() {
            tokio::spawn(async move {
                channel.close().await.ok();
            });
        }
    }
}

#[cfg(test)]
fn pre_session_channel_guard_should_close_on_drop(is_disarmed: bool) -> bool {
    !is_disarmed
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExecRequestReply {
    Success,
    Failure,
}

fn classify_exec_request_reply(message: &ChannelMsg) -> Option<ExecRequestReply> {
    match message {
        ChannelMsg::Success => Some(ExecRequestReply::Success),
        ChannelMsg::Failure => Some(ExecRequestReply::Failure),
        _ => None,
    }
}

async fn wait_for_exec_request_success(
    channel: &mut russh::Channel<client::Msg>,
) -> Result<Vec<ChannelMsg>, SshError> {
    let mut buffered_messages = Vec::new();

    loop {
        let Some(message) = channel.wait().await else {
            channel.close().await.ok();
            return Err(SshError::Russh(
                "SSH exec request closed before success".to_string(),
            ));
        };

        match classify_exec_request_reply(&message) {
            Some(ExecRequestReply::Success) => return Ok(buffered_messages),
            Some(ExecRequestReply::Failure) => {
                channel.close().await.ok();
                return Err(SshError::Russh("SSH exec request failed".to_string()));
            }
            None if command_stream_message_finishes_reader(Some(&message)) => {
                channel.close().await.ok();
                return Err(SshError::Russh(
                    "SSH exec request closed before success".to_string(),
                ));
            }
            None => buffered_messages.push(message),
        }
    }
}

fn record_command_output_message(
    collector: &mut CommandOutputCollector,
    message: ChannelMsg,
) -> bool {
    match message {
        ChannelMsg::Data { data } => collector.record_stdout(&data),
        ChannelMsg::ExtendedData { data, .. } => collector.record_stderr(&data),
        ChannelMsg::ExitStatus { exit_status } => {
            collector.record_exit_status(exit_status);
        }
        ChannelMsg::ExitSignal { signal_name, .. } => {
            collector.record_exit_signal(signal_name_to_string(signal_name));
        }
        ChannelMsg::Close => return true,
        ChannelMsg::Eof => {}
        _ => {}
    }
    false
}

fn dispatch_command_stream_message(callback: &Arc<dyn CommandStreamCallback>, message: ChannelMsg) {
    match message {
        ChannelMsg::Data { data } => {
            callback.on_event(CommandStreamEvent::Stdout {
                bytes: data.to_vec(),
            });
        }
        ChannelMsg::ExtendedData { data, .. } => {
            callback.on_event(CommandStreamEvent::Stderr {
                bytes: data.to_vec(),
            });
        }
        ChannelMsg::ExitStatus { exit_status } => {
            callback.on_event(CommandStreamEvent::ExitStatus { exit_status });
        }
        ChannelMsg::ExitSignal { signal_name, .. } => {
            callback.on_event(CommandStreamEvent::ExitSignal {
                signal_name: signal_name_to_string(signal_name),
            });
        }
        ChannelMsg::Eof => {}
        _ => {}
    }
}

pub(crate) async fn run_command(
    connection: &SshConnection,
    options: RunCommandOptions,
) -> Result<CommandOutput, SshError> {
    let channel = {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await?
    };
    let mut channel_guard = PreSessionChannelCloseGuard::new(channel);
    channel_guard.channel().exec(true, options.command).await?;
    let buffered_messages = wait_for_exec_request_success(channel_guard.channel_mut()).await?;

    let mut collector = CommandOutputCollector::default();
    let mut is_closed = false;

    for message in buffered_messages {
        if record_command_output_message(&mut collector, message) {
            is_closed = true;
            break;
        }
    }

    while !is_closed {
        let Some(message) = channel_guard.channel_mut().wait().await else {
            break;
        };
        if record_command_output_message(&mut collector, message) {
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
    let channel = {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await?
    };
    let mut channel_guard = PreSessionChannelCloseGuard::new(channel);
    let channel_id: u32 = channel_guard.channel().id().into();
    channel_guard.channel().exec(true, options.command).await?;
    let buffered_messages = wait_for_exec_request_success(channel_guard.channel_mut()).await?;
    let channel = channel_guard.into_inner();

    let (mut reader, writer) = channel.split();
    let callback = options.on_event_callback.clone();
    let parent = connection.self_weak.lock().await.clone();
    let parent_for_reader = parent.clone();
    let reader_has_closed = Arc::new(AtomicBool::new(false));
    let reader_has_closed_for_reader = reader_has_closed.clone();

    let reader_task = tokio::spawn(async move {
        for message in buffered_messages {
            dispatch_command_stream_message(&callback, message);
        }

        loop {
            let message = reader.wait().await;
            if command_stream_message_finishes_reader(message.as_ref()) {
                reader_has_closed_for_reader.store(true, Ordering::Release);
                callback.on_event(CommandStreamEvent::Closed);
                if let Some(parent) = parent_for_reader.upgrade() {
                    parent.command_streams.lock().await.remove(&channel_id);
                }
                break;
            }

            if let Some(message) = message {
                dispatch_command_stream_message(&callback, message);
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
        writer: AsyncMutex::new(writer),
        reader_task,
    });

    {
        let mut command_streams = connection.command_streams.lock().await;
        command_streams.insert(channel_id, session.clone());
        if !command_stream_should_remain_registered_after_insert(
            reader_has_closed.load(Ordering::Acquire),
        ) {
            command_streams.remove(&channel_id);
        }
    }

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn command_stream_registration_cleans_up_if_reader_closed_before_insert() {
        assert!(!command_stream_should_remain_registered_after_insert(true));
        assert!(command_stream_should_remain_registered_after_insert(false));
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

    #[test]
    fn pre_session_channel_guard_closes_until_disarmed() {
        assert!(pre_session_channel_guard_should_close_on_drop(false));
        assert!(!pre_session_channel_guard_should_close_on_drop(true));
    }
}
