use super::*;

struct FrameHeader {
    fin: bool,
    opcode: Opcode,
    length: usize,
    mask: [u8; 4],
}

/// The connection's single reader. Reuse one payload buffer across successive reads.
pub struct WebSocketReader {
    socket: WebSocket,
    input: BufReader<ReadTransport>,
}

impl WebSocketReader {
    pub(super) fn new(socket: WebSocket, input: ReadTransport) -> Self {
        Self {
            socket,
            input: BufReader::with_capacity(4096, input),
        }
    }

    /// Cancel a pending read only when closing the connection.
    pub async fn read_message_into<'a>(
        &mut self,
        payload: &'a mut Vec<u8>,
    ) -> Result<(MessageKind, &'a [u8]), SocketError> {
        let done = self.socket.state.done.clone();
        let kind = tokio::select! {
            biased;
            () = done.cancelled() => return Err(SocketError::Closed),
            result = self.read_message(payload) => result?,
        };
        Ok((kind, payload))
    }

    async fn read_message(&mut self, payload: &mut Vec<u8>) -> Result<MessageKind, SocketError> {
        payload.clear();
        let mut kind = None;
        let mut control = [0; MAX_CONTROL_PAYLOAD];

        loop {
            let frame = self.read_header().await?;
            match frame.opcode {
                Opcode::Ping | Opcode::Pong | Opcode::Close => {
                    let control = &mut control[..frame.length];
                    self.read_payload(&frame, control).await?;
                    if frame.opcode == Opcode::Ping {
                        self.socket.enqueue(Opcode::Pong, control)?;
                    } else if frame.opcode == Opcode::Pong {
                        *lock(&self.socket.state.last_pong) = Instant::now();
                    } else {
                        self.socket.terminate();
                        return Err(SocketError::Closed);
                    }
                    continue;
                }
                Opcode::Binary | Opcode::Text if kind.is_none() => {
                    kind = Some(if frame.opcode == Opcode::Binary {
                        MessageKind::Binary
                    } else {
                        MessageKind::Text
                    });
                }
                Opcode::Continuation if kind.is_some() => {}
                _ => return Err(SocketError::BadFrame),
            }

            let offset = payload.len();
            if offset + frame.length > MAX_PAYLOAD {
                return Err(SocketError::BadFrame);
            }

            payload.reserve(frame.length);
            let mut body = (&mut self.input).take(frame.length as u64);
            while body.limit() != 0 {
                if body.read_buf(payload).await? == 0 {
                    return Err(io::Error::from(io::ErrorKind::UnexpectedEof).into());
                }
            }
            apply_mask(frame.mask, &mut payload[offset..]);
            if frame.fin {
                return kind.ok_or(SocketError::BadFrame);
            }
        }
    }

    async fn read_header(&mut self) -> Result<FrameHeader, SocketError> {
        let mut prefix = [0; 2];
        self.input.read_exact(&mut prefix).await?;
        let fin = prefix[0] & 0x80 != 0;
        if prefix[0] & 0x70 != 0 || prefix[1] & 0x80 == 0 {
            return Err(SocketError::BadFrame);
        }

        let opcode = Opcode::try_from(prefix[0] & 0x0f)?;
        let length = match prefix[1] & 0x7f {
            126 => {
                let length = self.input.read_u16().await?;
                if length < 126 {
                    return Err(SocketError::BadFrame);
                }
                usize::from(length)
            }
            127 => {
                // The 64-bit form starts above the game's entire payload limit.
                return Err(SocketError::BadFrame);
            }
            length => usize::from(length),
        };
        if length > MAX_PAYLOAD || (opcode as u8 >= 8 && (!fin || length > MAX_CONTROL_PAYLOAD)) {
            return Err(SocketError::BadFrame);
        }

        let mut mask = [0; 4];
        self.input.read_exact(&mut mask).await?;
        Ok(FrameHeader {
            fin,
            opcode,
            length,
            mask,
        })
    }

    async fn read_payload(
        &mut self,
        frame: &FrameHeader,
        payload: &mut [u8],
    ) -> Result<(), SocketError> {
        self.input.read_exact(payload).await?;
        apply_mask(frame.mask, payload);
        Ok(())
    }
}

pub(super) fn apply_mask(mask: [u8; 4], payload: &mut [u8]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index & 3];
    }
}
