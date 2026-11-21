use super::*;

pub(super) struct Outbound {
    state: Arc<SocketState>,
    pub(super) bytes: Vec<u8>,
    offset: usize,
    length: usize,
    pub(super) queued: bool,
    pub(super) closing: bool,
}

impl Outbound {
    pub(super) fn new(
        state: &Arc<SocketState>,
        opcode: Opcode,
        payload: &[u8],
        header: &[u8; FRAME_HEADER_SIZE],
        offset: usize,
    ) -> Self {
        let mut bytes = lock(&state.spare).take().unwrap_or_default();
        bytes.clear();
        bytes.reserve(FRAME_HEADER_SIZE + payload.len());
        bytes.extend_from_slice(header);
        bytes.extend_from_slice(payload);
        Self {
            state: Arc::clone(state),
            bytes,
            offset,
            length: payload.len(),
            queued: false,
            closing: opcode == Opcode::Close,
        }
    }

    pub(super) fn wire(&self) -> &[u8] {
        &self.bytes[self.offset..]
    }
}

impl Drop for Outbound {
    fn drop(&mut self) {
        let mut spare = lock(&self.state.spare);
        if spare.is_none() {
            *spare = Some(std::mem::take(&mut self.bytes));
        }

        self.state.buffered.fetch_sub(self.length, Ordering::AcqRel);
        if self.queued {
            self.state.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub(super) fn write_header(
    opcode: Opcode,
    size: usize,
    bytes: &mut [u8; FRAME_HEADER_SIZE],
) -> usize {
    let offset = match size {
        0..=125 => {
            bytes[9] = size as u8;
            8
        }
        126..=65535 => {
            bytes[7] = 126;
            bytes[8..10].copy_from_slice(&(size as u16).to_be_bytes());
            6
        }
        _ => {
            bytes[1] = 127;
            bytes[2..10].copy_from_slice(&(size as u64).to_be_bytes());
            0
        }
    };
    bytes[offset] = 0x80 | opcode as u8;
    offset
}

pub(super) enum WriteTransport {
    Tcp(Arc<OwnedWriteHalf>),
    Other(Pin<Box<dyn AsyncWrite + Send>>),
}

impl WriteTransport {
    async fn write_frame(&mut self, mut wire: &[u8]) -> io::Result<()> {
        match self {
            Self::Tcp(writer) => {
                while !wire.is_empty() {
                    writer.writable().await?;
                    match writer.try_write(wire) {
                        Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                        Ok(count) => wire = &wire[count..],
                        Err(error)
                            if matches!(
                                error.kind(),
                                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                            ) => {}
                        Err(error) => return Err(error),
                    }
                }
                Ok(())
            }
            Self::Other(writer) => {
                writer.write_all(wire).await?;
                writer.flush().await
            }
        }
    }
}

pub(super) async fn write_pump(
    socket: WebSocket,
    mut outbound: mpsc::Receiver<Outbound>,
    mut writer: WriteTransport,
) {
    loop {
        let frame = tokio::select! {
            biased;
            () = socket.done() => break,
            frame = outbound.recv() => frame,
        };
        let Some(frame) = frame else {
            break;
        };

        let result = tokio::select! {
            biased;
            () = socket.done() => break,
            result = timeout(WRITE_TIMEOUT, writer.write_frame(frame.wire())) => result,
        };
        let closing = frame.closing;
        drop(frame);
        if !matches!(result, Ok(Ok(()))) || closing {
            break;
        }
    }

    socket.terminate();
}
