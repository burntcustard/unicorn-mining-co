use super::{ProtocolError, Vector};

pub(super) const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

pub(super) fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn parse_uuid(value: &str) -> Option<[u8; 16]> {
    let bytes = value.as_bytes();
    if bytes.len() != 36 || [8, 13, 18, 23].iter().any(|&index| bytes[index] != b'-') {
        return None;
    }

    let mut decoded = [0; 16];
    let mut position = 0;
    for byte in &mut decoded {
        if matches!(position, 8 | 13 | 18 | 23) {
            position += 1;
        }

        let high = hex_digit(bytes[position])?;
        let low = hex_digit(bytes[position + 1])?;
        *byte = high << 4 | low;
        position += 2;
    }

    Some(decoded)
}

pub(super) struct Writer<'a> {
    pub(super) data: &'a mut Vec<u8>,
}

impl Writer<'_> {
    pub(super) fn byte(&mut self, value: u8) {
        self.data.push(value);
    }

    pub(super) fn unsigned(&mut self, mut value: u64) {
        while value >= 128 {
            self.byte(value as u8 | 128);
            value >>= 7;
        }

        self.byte(value as u8);
    }

    pub(super) fn signed(&mut self, value: i64) {
        self.unsigned(((value as u64) << 1) ^ ((value >> 63) as u64));
    }

    pub(super) fn number(&mut self, value: f64) {
        self.data.extend_from_slice(&value.to_le_bytes());
    }

    pub(super) fn vector(&mut self, value: Vector) {
        self.number(value.x);
        self.number(value.y);
    }
}

pub(super) struct Reader<'a> {
    remaining: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(super) fn new(data: &'a [u8]) -> Self {
        Self { remaining: data }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.remaining.is_empty()
    }

    pub(super) fn take(&mut self, length: usize) -> Result<&'a [u8], ProtocolError> {
        let (value, remaining) = self
            .remaining
            .split_at_checked(length)
            .ok_or(ProtocolError::Control)?;
        self.remaining = remaining;
        Ok(value)
    }

    pub(super) fn byte(&mut self) -> Result<u8, ProtocolError> {
        let (&value, remaining) = self.remaining.split_first().ok_or(ProtocolError::Control)?;
        self.remaining = remaining;
        Ok(value)
    }

    pub(super) fn unsigned(&mut self) -> Result<u64, ProtocolError> {
        self.unsigned_limit(MAX_SAFE_INTEGER)
    }

    fn unsigned_limit(&mut self, limit: u64) -> Result<u64, ProtocolError> {
        let mut value = 0;

        for index in 0..8 {
            let part = self.byte()?;
            let digit = u64::from(part & 127);
            value |= digit << (7 * index);

            if part & 128 == 0 {
                return if (index > 0 && digit == 0) || value > limit {
                    Err(ProtocolError::Control)
                } else {
                    Ok(value)
                };
            }
        }

        Err(ProtocolError::Control)
    }

    pub(super) fn signed(&mut self) -> Result<i64, ProtocolError> {
        let encoded = self.unsigned_limit(2 * MAX_SAFE_INTEGER)?;
        Ok((encoded >> 1) as i64 ^ -((encoded & 1) as i64))
    }

    pub(super) fn number(&mut self) -> Result<f64, ProtocolError> {
        let (bytes, remaining) = self
            .remaining
            .split_first_chunk()
            .ok_or(ProtocolError::Control)?;
        self.remaining = remaining;
        let value = f64::from_le_bytes(*bytes);

        if !value.is_finite() {
            return Err(ProtocolError::Control);
        }

        Ok(if value == 0.0 { 0.0 } else { value })
    }

    pub(super) fn vector(&mut self) -> Result<Vector, ProtocolError> {
        Ok(Vector {
            x: self.number()?,
            y: self.number()?,
        })
    }
}
