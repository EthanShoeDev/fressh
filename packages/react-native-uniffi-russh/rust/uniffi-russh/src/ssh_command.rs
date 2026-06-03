use std::sync::{Arc, Weak};

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

pub(crate) async fn run_command(
    connection: &SshConnection,
    options: RunCommandOptions,
) -> Result<CommandOutput, SshError> {
    let mut channel = {
        let client_handle = connection.client_handle.lock().await;
        client_handle.channel_open_session().await?
    };
    channel.exec(true, options.command).await?;

    let mut collector = CommandOutputCollector::default();

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => collector.record_stdout(&data),
            ChannelMsg::ExtendedData { data, .. } => collector.record_stderr(&data),
            ChannelMsg::ExitStatus { exit_status } => {
                collector.record_exit_status(exit_status);
            }
            ChannelMsg::ExitSignal { signal_name, .. } => {
                collector.record_exit_signal(signal_name_to_string(signal_name));
            }
            ChannelMsg::Close => break,
            ChannelMsg::Eof => {}
            _ => {}
        }
    }

    channel.close().await.ok();
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
    let channel_id: u32 = channel.id().into();
    channel.exec(true, options.command).await?;

    let (mut reader, writer) = channel.split();
    let callback = options.on_event_callback.clone();

    let reader_task = tokio::spawn(async move {
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    callback.on_event(CommandStreamEvent::Stdout {
                        bytes: data.to_vec(),
                    });
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    callback.on_event(CommandStreamEvent::Stderr {
                        bytes: data.to_vec(),
                    });
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    callback.on_event(CommandStreamEvent::ExitStatus { exit_status });
                }
                Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                    callback.on_event(CommandStreamEvent::ExitSignal {
                        signal_name: signal_name_to_string(signal_name),
                    });
                }
                Some(ChannelMsg::Close) | None => {
                    callback.on_event(CommandStreamEvent::Closed);
                    break;
                }
                Some(ChannelMsg::Eof) => {}
                _ => {}
            }
        }
    });

    let session = Arc::new(CommandStreamSession {
        info: CommandStreamInfo {
            channel_id,
            created_at_ms: started_at_ms,
            connection_id: connection.info.connection_id.clone(),
        },
        parent: connection.self_weak.lock().await.clone(),
        writer: AsyncMutex::new(writer),
        reader_task,
    });

    connection
        .command_streams
        .lock()
        .await
        .insert(channel_id, session.clone());

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
}
