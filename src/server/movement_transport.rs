//! Optional, unreliable server-to-browser movement over a shared WebRTC socket.

use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::channel::{ChannelId, Reliability};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc};
use tokio::net::UdpSocket;
use tokio::sync::{mpsc, oneshot};
use tokio::task::LocalSet;

pub(crate) const MOVEMENT_SHIP_LIMIT: usize = 6;
const MOVEMENT_RECORD_BYTES: usize = 32;
pub(crate) const MAX_MOVEMENT_BYTES: usize = 8 + MOVEMENT_SHIP_LIMIT * MOVEMENT_RECORD_BYTES;
const SCTP_BUFFER_BYTES: usize = 8 * 1024;
const MAX_OFFERS: usize = 64;
const OFFER_TIMEOUT: Duration = Duration::from_secs(10);
const PACKET_LIFETIME: Duration = Duration::from_millis(33);
const SCTP_PACKET_LIFETIME_MS: u16 = 32;

/// One UDP socket and actor shared by the game's WebSocket sessions.
#[derive(Clone)]
pub struct MovementTransport {
    commands: mpsc::Sender<Command>,
    next_peer: Arc<AtomicU64>,
}

pub(crate) struct MovementSender {
    id: u64,
    commands: mpsc::Sender<Command>,
    state: Arc<PeerState>,
}

#[derive(Default)]
struct PeerState {
    open: AtomicBool,
    last_tick: AtomicU64,
    latest: Mutex<Option<Packet>>,
}

struct Packet {
    length: usize,
    bytes: [u8; MAX_MOVEMENT_BYTES],
    expires: Instant,
}

enum Command {
    Offer {
        id: u64,
        offer: SdpOffer,
        state: Weak<PeerState>,
        answer: oneshot::Sender<io::Result<String>>,
    },
    Ready(u64),
    Close(u64),
}

impl MovementTransport {
    /// Bind locally and advertise the externally reachable ICE address.
    pub async fn start(
        local: &LocalSet,
        bind: SocketAddr,
        mut advertise: SocketAddr,
    ) -> io::Result<Self> {
        let socket = UdpSocket::bind(bind).await?;
        socket.writable().await?;
        if advertise.port() == 0 {
            advertise.set_port(socket.local_addr()?.port());
        }
        let candidate = Candidate::host(advertise, "udp").map_err(invalid_data)?;
        let (commands, receiver) = mpsc::channel(MAX_OFFERS * 3);
        local.spawn_local(run(socket, advertise, candidate, receiver));
        Ok(Self {
            commands,
            next_peer: Arc::default(),
        })
    }

    pub(crate) async fn offer(&self, offer: String) -> io::Result<(String, MovementSender)> {
        let mut media = offer.lines().filter(|line| line.starts_with("m="));
        if !media
            .next()
            .is_some_and(|line| line.starts_with("m=application "))
            || media.next().is_some()
        {
            return Err(invalid_data("Expected one SDP data-channel media line"));
        }
        let offer = SdpOffer::from_sdp_string(&offer).map_err(invalid_data)?;
        let id = self.next_peer.fetch_add(1, Ordering::Relaxed);
        let sender = MovementSender {
            id,
            commands: self.commands.clone(),
            state: Arc::default(),
        };
        let (answer, response) = oneshot::channel();
        self.commands
            .try_send(Command::Offer {
                id,
                offer,
                state: Arc::downgrade(&sender.state),
                answer,
            })
            .map_err(|_| io::ErrorKind::WouldBlock)?;
        Ok((
            response.await.map_err(|_| io::ErrorKind::BrokenPipe)??,
            sender,
        ))
    }
}

impl MovementSender {
    pub(crate) fn should_send(&self, tick: u64, interval: u64) -> bool {
        let last_tick = self.state.last_tick.load(Ordering::Relaxed);
        self.state.open.load(Ordering::Acquire)
            && (tick < last_tick || tick - last_tick >= interval)
    }

    pub(crate) fn send(&self, tick: u64, data: &[u8]) {
        debug_assert!(!data.is_empty() && data.len() <= MAX_MOVEMENT_BYTES);
        let Ok(mut latest) = self.state.latest.try_lock() else {
            return;
        };
        let notify = latest.is_none();
        let expires = Instant::now() + PACKET_LIFETIME;
        let packet = latest.get_or_insert_with(|| Packet {
            length: 0,
            bytes: [0; MAX_MOVEMENT_BYTES],
            expires,
        });
        packet.length = data.len();
        packet.expires = expires;
        packet.bytes[..data.len()].copy_from_slice(data);
        if notify && self.commands.try_send(Command::Ready(self.id)).is_err() {
            *latest = None;
            return;
        }
        self.state.last_tick.store(tick, Ordering::Relaxed);
    }
}

impl Drop for MovementSender {
    fn drop(&mut self) {
        self.state.open.store(false, Ordering::Release);
        let _ = self.commands.try_send(Command::Close(self.id));
    }
}

struct Peer {
    rtc: Rtc,
    channel: Option<ChannelId>,
    state: Weak<PeerState>,
    timeout: Instant,
    expires: Instant,
    waiting_to_send: bool,
}

impl Peer {
    fn new(
        candidate: Candidate,
        offer: SdpOffer,
        state: Weak<PeerState>,
    ) -> io::Result<(Self, String)> {
        let now = Instant::now();
        let mut rtc = Rtc::builder()
            .set_ice_lite(true)
            .set_sctp_max_buffered_amount(SCTP_BUFFER_BYTES)
            .set_sctp_max_message_size(MAX_MOVEMENT_BYTES as u32)
            .build(now);
        rtc.add_local_candidate(candidate);
        let answer = rtc.sdp_api().accept_offer(offer).map_err(invalid_data)?;
        let peer = Self {
            rtc,
            channel: None,
            state,
            timeout: now,
            expires: now + OFFER_TIMEOUT,
            waiting_to_send: false,
        };
        Ok((peer, answer.to_sdp_string()))
    }

    fn deadline(&self) -> Instant {
        if self.channel.is_none() {
            self.timeout.min(self.expires)
        } else {
            self.timeout
        }
    }

    fn write_latest(&mut self) -> bool {
        let Some(state) = self.state.upgrade() else {
            return false;
        };
        let packet = state
            .latest
            .lock()
            .ok()
            .and_then(|mut latest| latest.take());
        let now = Instant::now();
        if self.rtc.handle_input(Input::Timeout(now)).is_err() {
            return false;
        }
        if let Some(packet) = packet
            && now < packet.expires
            && let Some(mut channel) = self.channel.and_then(|id| self.rtc.channel(id))
            && (!self.waiting_to_send || channel.buffered_amount() == 0)
        {
            self.waiting_to_send = channel
                .write(true, &packet.bytes[..packet.length])
                .unwrap_or(false);
        }
        true
    }

    fn flush(&mut self, socket: &UdpSocket) -> bool {
        while self.rtc.is_alive() {
            match self.rtc.poll_output() {
                Ok(Output::Transmit(packet)) => {
                    // After ICE, DTLS carries the movement data channel. STUN
                    // output does not mean SCTP made room for another write.
                    if packet
                        .contents
                        .first()
                        .is_some_and(|kind| (20..64).contains(kind))
                    {
                        self.waiting_to_send = false;
                    }
                    let _ = socket.try_send_to(&packet.contents, packet.destination);
                }
                Ok(Output::Event(Event::ChannelOpen(id, label))) => {
                    if label != "movement"
                        || self.channel.is_some()
                        || !self.rtc.channel(id).is_some_and(|channel| {
                            channel.config().is_some_and(|config| {
                                !config.ordered
                                    && config.reliability
                                        == Reliability::MaxPacketLifetime {
                                            lifetime: SCTP_PACKET_LIFETIME_MS,
                                        }
                            })
                        })
                    {
                        return false;
                    }
                    let Some(state) = self.state.upgrade() else {
                        return false;
                    };
                    self.channel = Some(id);
                    state.open.store(true, Ordering::Release);
                }
                Ok(Output::Event(Event::ChannelClose(_) | Event::ChannelData(_))) | Err(_) => {
                    return false;
                }
                Ok(Output::Event(_)) => {}
                Ok(Output::Timeout(timeout)) => {
                    self.timeout = timeout;
                    return self.state.strong_count() != 0;
                }
            }
        }
        false
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        if let Some(state) = self.state.upgrade() {
            state.open.store(false, Ordering::Release);
        }
    }
}

fn invalid_data(error: impl ToString) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

async fn run(
    socket: UdpSocket,
    advertise: SocketAddr,
    candidate: Candidate,
    mut commands: mpsc::Receiver<Command>,
) {
    let mut peers = HashMap::<u64, Peer>::new();
    let mut routes = HashMap::<SocketAddr, u64>::new();
    let mut packet = [0; 2048];
    let mut pending = Vec::new();
    let mut due = Vec::new();
    let timer = tokio::time::sleep(Duration::ZERO);
    tokio::pin!(timer);
    loop {
        let deadline = peers
            .values()
            .map(Peer::deadline)
            .min()
            .map(tokio::time::Instant::from);
        if let Some(deadline) = deadline
            && deadline != timer.deadline()
        {
            timer.as_mut().reset(deadline);
        }
        tokio::select! {
            count = commands.recv_many(&mut pending, 8) => {
                if count == 0 { return; }
                for command in pending.drain(..) {
                    match command {
                        Command::Offer { id, offer, state, answer } => {
                            if answer.is_closed() {
                                continue;
                            }
                            if peers.len() >= MAX_OFFERS {
                                let _ = answer.send(Err(io::ErrorKind::WouldBlock.into()));
                                continue;
                            }
                            let result = Peer::new(candidate.clone(), offer, state).map(|(peer, sdp)| {
                                peers.insert(id, peer);
                                sdp
                            });
                            if answer.send(result).is_err() {
                                peers.remove(&id);
                            }
                        }
                        Command::Ready(id) => {
                            if let Some(peer) = peers.get_mut(&id)
                                && (!peer.write_latest() || !peer.flush(&socket))
                            {
                                remove(&mut peers, &mut routes, id);
                            }
                        }
                        Command::Close(id) => remove(&mut peers, &mut routes, id),
                    }
                }
            },
            input = socket.recv_from(&mut packet) => {
                let Ok((length, source)) = input else { return; };
                let Ok(receive) = Receive::new(Protocol::Udp, source, advertise, &packet[..length]) else {
                    continue;
                };
                let input = Input::Receive(Instant::now(), receive);
                let route = routes.get(&source).copied()
                    .filter(|id| peers.get(id).is_some_and(|peer| peer.rtc.accepts(&input)))
                    .or_else(|| peers.iter().find_map(|(&id, peer)| peer.rtc.accepts(&input).then_some(id)));
                if let Some(id) = route
                    && let Some(peer) = peers.get_mut(&id)
                {
                    if peer.rtc.handle_input(input).is_ok() && peer.flush(&socket) {
                        if routes.get(&source) != Some(&id) {
                            routes.retain(|_, peer| *peer != id);
                            routes.insert(source, id);
                        }
                    } else {
                        remove(&mut peers, &mut routes, id);
                    }
                }
            }
            _ = &mut timer, if deadline.is_some() => {
                let now = Instant::now();
                due.extend(peers.iter().filter_map(|(&id, peer)| (peer.deadline() <= now).then_some(id)));
                for id in due.drain(..) {
                    if let Some(peer) = peers.get_mut(&id)
                        && (peer.channel.is_none() && peer.expires <= now
                            || peer.rtc.handle_input(Input::Timeout(now)).is_err()
                            || !peer.flush(&socket))
                    {
                        remove(&mut peers, &mut routes, id);
                    }
                }
            }
        }
    }
}

fn remove(peers: &mut HashMap<u64, Peer>, routes: &mut HashMap<SocketAddr, u64>, id: u64) {
    peers.remove(&id);
    routes.retain(|_, peer| *peer != id);
}
