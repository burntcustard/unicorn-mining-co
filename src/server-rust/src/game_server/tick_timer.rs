use std::io;

use tokio::time::Instant;

#[cfg(target_os = "linux")]
mod linux {
    use std::fs::File;
    use std::io::Read;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::time::Duration;

    use tokio::io::{Interest, unix::AsyncFd};

    use super::{Instant, io};

    pub(in crate::game_server) struct Timer {
        descriptor: AsyncFd<File>,
        reference: Instant,
        monotonic_reference: Duration,
    }

    impl Timer {
        pub(in crate::game_server) fn new(deadline: Instant) -> io::Result<Self> {
            // Rust Instants on Linux and timerfd use the same monotonic clock.
            let reference = Instant::now();
            let mut timestamp = MaybeUninit::<libc::timespec>::uninit();
            // SAFETY: clock_gettime writes into a valid timespec allocation.
            if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, timestamp.as_mut_ptr()) } < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: clock_gettime succeeded and filled the timespec.
            let timestamp = unsafe { timestamp.assume_init() };
            let monotonic_reference =
                Duration::new(timestamp.tv_sec as u64, timestamp.tv_nsec as u32);
            // SAFETY: timerfd_create returns a new descriptor or an error.
            let descriptor = unsafe {
                libc::timerfd_create(
                    libc::CLOCK_MONOTONIC,
                    libc::TFD_CLOEXEC | libc::TFD_NONBLOCK,
                )
            };
            if descriptor < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: timerfd_create succeeded and ownership transfers here.
            let file = File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
            // SAFETY: File owns the descriptor for the life of AsyncFd.
            let descriptor = unsafe { AsyncFd::register_with_interest(file, Interest::READABLE)? };
            let mut timer = Self {
                descriptor,
                reference,
                monotonic_reference,
            };
            timer.reset(deadline)?;
            Ok(timer)
        }

        pub(in crate::game_server) fn reset(&mut self, deadline: Instant) -> io::Result<()> {
            let deadline = self.monotonic_reference + deadline.duration_since(self.reference);
            let alarm = libc::itimerspec {
                it_interval: libc::timespec {
                    tv_sec: 0,
                    tv_nsec: 0,
                },
                it_value: libc::timespec {
                    tv_sec: deadline.as_secs() as libc::time_t,
                    tv_nsec: deadline.subsec_nanos() as libc::c_long,
                },
            };
            // SAFETY: The descriptor owns a timer and alarm points to an initialized itimerspec.
            if unsafe {
                libc::timerfd_settime(
                    self.descriptor.as_raw_fd(),
                    libc::TFD_TIMER_ABSTIME,
                    &alarm,
                    std::ptr::null_mut(),
                )
            } < 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub(in crate::game_server) async fn wait(&mut self) -> io::Result<()> {
            self.descriptor
                .async_io(Interest::READABLE, |mut descriptor| {
                    descriptor.read_exact(&mut [0; 8])
                })
                .await
        }
    }
}

pub(super) enum TickTimer {
    #[cfg(target_os = "linux")]
    Precise(linux::Timer),
    Tokio(std::pin::Pin<Box<tokio::time::Sleep>>),
}

impl TickTimer {
    pub(super) fn new(deadline: Instant) -> Self {
        #[cfg(target_os = "linux")]
        if let Ok(timer) = linux::Timer::new(deadline) {
            return Self::Precise(timer);
        }
        Self::Tokio(Box::pin(tokio::time::sleep_until(deadline)))
    }

    pub(super) fn reset(&mut self, deadline: Instant) -> io::Result<()> {
        match self {
            #[cfg(target_os = "linux")]
            Self::Precise(timer) => timer.reset(deadline),
            Self::Tokio(sleep) => {
                sleep.as_mut().reset(deadline);
                Ok(())
            }
        }
    }

    pub(super) async fn wait(&mut self) -> io::Result<()> {
        match self {
            #[cfg(target_os = "linux")]
            Self::Precise(timer) => timer.wait().await,
            Self::Tokio(sleep) => {
                sleep.as_mut().await;
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{Instant, TickTimer};

    async fn rearm(mut timer: TickTimer) {
        for _ in 0..2 {
            let deadline = Instant::now() + Duration::from_millis(5);
            timer.reset(deadline).unwrap();
            tokio::time::timeout(Duration::from_secs(2), timer.wait())
                .await
                .unwrap()
                .unwrap();
            assert!(Instant::now() >= deadline);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn precise_timer_waits_for_each_deadline_after_rearming() {
        let timer = super::linux::Timer::new(Instant::now()).unwrap();
        rearm(TickTimer::Precise(timer)).await;
    }

    #[tokio::test]
    async fn tokio_fallback_waits_for_each_deadline_after_rearming() {
        let sleep = tokio::time::sleep_until(Instant::now());
        rearm(TickTimer::Tokio(Box::pin(sleep))).await;
    }
}
