use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub production: bool,
    pub port: u16,
    pub world_seed: f64,
    pub assets: PathBuf,
    pub database: PathBuf,
    pub backups: PathBuf,
}

impl Config {
    pub fn from_environment() -> io::Result<Self> {
        Self::load(|key| std::env::var_os(key))
    }

    fn load(mut variable: impl FnMut(&str) -> Option<OsString>) -> io::Result<Self> {
        let mut value = |key| variable(key).filter(|value| !value.is_empty());
        let production = value("APP_ENV").as_deref() == Some(OsStr::new("production"))
            || value("NODE_ENV").as_deref() == Some(OsStr::new("production"));
        let database = match value("DATABASE_PATH") {
            Some(path) => PathBuf::from(path),
            None if production => {
                return Err(invalid(
                    "DATABASE_PATH must point to persistent storage in production",
                ));
            }
            None => PathBuf::from(".data/world.sqlite"),
        };
        let backups = value("BACKUP_DIRECTORY").map_or_else(
            || database.parent().unwrap_or(Path::new(".")).join("backups"),
            PathBuf::from,
        );
        let assets = value("ASSET_DIR").map_or_else(|| PathBuf::from("dist"), PathBuf::from);
        let port = if let Some(port) = value("PORT") {
            port.to_str()
                .and_then(|value| value.parse().ok())
                .ok_or_else(|| invalid("invalid PORT"))?
        } else {
            3001
        };
        let world_seed = if let Some(seed) = value("WORLD_SEED") {
            seed.to_str()
                .and_then(|value| value.parse().ok())
                .ok_or_else(|| invalid("invalid WORLD_SEED"))?
        } else {
            25.0
        };
        Ok(Self {
            production,
            port,
            world_seed,
            assets,
            database,
            backups,
        })
    }

    /// Initialize a mounted Fly volume and drop privileges before starting threads.
    pub fn prepare_volume(&self) -> io::Result<()> {
        use std::fs::{Permissions, set_permissions};
        use std::os::unix::fs::{PermissionsExt, chown};

        const SERVICE_ID: u32 = 65532;
        let mount = Path::new("/data");
        if !self.production || self.database.parent() != Some(mount) {
            return Ok(());
        }
        // SAFETY: getuid takes no pointers and has no preconditions.
        if unsafe { libc::getuid() } != 0 {
            return Ok(());
        }

        chown(mount, Some(SERVICE_ID), Some(SERVICE_ID))?;
        set_permissions(mount, Permissions::from_mode(0o700))?;
        // SAFETY: an empty supplemental group list accepts a null pointer.
        // These libc calls run before the server starts its worker threads.
        if unsafe { libc::setgroups(0, std::ptr::null()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: service IDs are valid uid_t/gid_t values for the platform.
        if unsafe { libc::setgid(SERVICE_ID) } != 0 || unsafe { libc::setuid(SERVICE_ID) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Command {
    Serve,
    ResetWorld,
    ResetWorldLive,
    ResumeWorldLive,
    CpuProfileLive(u8),
    Backups,
    DeleteBackup(PathBuf),
    DeleteAllBackups,
    Help,
}

impl Command {
    pub fn parse(args: impl IntoIterator<Item = OsString>) -> io::Result<Self> {
        let mut reset_world = false;
        let mut reset_live = false;
        let mut resume_live = false;
        let mut backups = false;
        let mut delete_all = false;
        let mut profile_seconds = 0;
        let mut delete_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if arg == "--" {
                break;
            }
            let text = arg.to_str().ok_or_else(|| invalid("invalid flag"))?;
            let name_value = text
                .strip_prefix("--")
                .or_else(|| text.strip_prefix('-'))
                .ok_or_else(|| invalid("choose one maintenance command without extra arguments"))?;
            let (name, value) = name_value
                .split_once('=')
                .map_or((name_value, None), |(name, value)| (name, Some(value)));
            let boolean = |value| match value {
                None | Some("1" | "t" | "T" | "true" | "TRUE" | "True") => Ok(true),
                Some("0" | "f" | "F" | "false" | "FALSE" | "False") => Ok(false),
                _ => Err(invalid("invalid boolean flag")),
            };
            match name {
                "reset-world" => reset_world = boolean(value)?,
                "reset-world-live" => reset_live = boolean(value)?,
                "resume-world-live" => resume_live = boolean(value)?,
                "backups" => backups = boolean(value)?,
                "delete-all-backups" => delete_all = boolean(value)?,
                "delete-backup" => {
                    delete_path = value.map(OsString::from).or_else(|| args.next());
                    if delete_path.as_ref().is_none_or(|path| path.is_empty()) {
                        return Err(invalid(
                            "delete-backup requires a nonempty path from the backup listing",
                        ));
                    }
                }
                "cpu-profile-live" => {
                    let seconds = value.map(OsString::from).or_else(|| args.next());
                    profile_seconds = seconds
                        .as_deref()
                        .and_then(OsStr::to_str)
                        .and_then(|seconds| seconds.parse::<u8>().ok())
                        .filter(|seconds| *seconds <= 60)
                        .ok_or_else(|| invalid("cpu-profile-live requires 1-60 seconds"))?;
                }
                "h" | "help" => return Ok(Self::Help),
                _ => return Err(invalid("unknown server flag")),
            }
        }
        let choices = [
            reset_world.then_some(Self::ResetWorld),
            reset_live.then_some(Self::ResetWorldLive),
            resume_live.then_some(Self::ResumeWorldLive),
            backups.then_some(Self::Backups),
            delete_all.then_some(Self::DeleteAllBackups),
            (profile_seconds > 0).then_some(Self::CpuProfileLive(profile_seconds)),
            delete_path.map(|path| Self::DeleteBackup(PathBuf::from(path))),
        ];
        let mut enabled = choices.into_iter().flatten();
        let choice = enabled.next().unwrap_or(Self::Serve);
        if enabled.next().is_some() || args.next().is_some() {
            return Err(invalid(
                "choose one maintenance command without extra arguments",
            ));
        }
        Ok(choice)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_requires_an_explicit_persistent_database() {
        assert!(Config::load(|key| (key == "APP_ENV").then(|| "production".into())).is_err());
        let config = Config::load(|key| match key {
            "APP_ENV" => Some("production".into()),
            "PORT" => Some("8080".into()),
            "DATABASE_PATH" => Some("/data/world.sqlite".into()),
            _ => None,
        })
        .unwrap();
        assert!(config.production);
        assert_eq!(config.backups, Path::new("/data/backups"));
        assert_eq!(config.port, 8080);
        assert_eq!(config.world_seed, 25.0);
        assert_eq!(
            Config::load(|_| None).unwrap().database,
            Path::new(".data/world.sqlite")
        );
    }

    #[test]
    fn maintenance_accepts_a_single_command_and_checks_arguments() {
        let parse = |args: &[&str]| Command::parse(args.iter().map(OsString::from));
        assert_eq!(parse(&[]).unwrap(), Command::Serve);
        assert_eq!(
            parse(&["--cpu-profile-live=12"]).unwrap(),
            Command::CpuProfileLive(12)
        );
        assert_eq!(
            parse(&["--backups=false", "-reset-world"]).unwrap(),
            Command::ResetWorld
        );
        assert!(parse(&["--delete-backup", ""]).is_err());
        assert!(parse(&["--cpu-profile-live=61"]).is_err());
        assert!(parse(&["--backups", "--reset-world"]).is_err());
        assert!(parse(&["--reset-world", "extra"]).is_err());
    }
}
