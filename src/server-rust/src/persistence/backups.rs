use std::ffi::CString;
use std::fs::{self, DirBuilder, File, Metadata};
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::backup::{Backup, StepResult};
use rusqlite::{Connection, OpenFlags};
use time::OffsetDateTime;
use time::macros::format_description;

use super::{Result, create_directory, directory_of, lock_database, with_suffix};

const RETAINED_BACKUPS: usize = 12;
const BACKUP_PAGES_PER_STEP: i32 = 128;
const BACKUP_STEP_DELAY: Duration = Duration::from_millis(2);

pub fn create_backup(source: &Path, directory: &Path) -> Result<PathBuf> {
    backup(source, directory, &AtomicBool::new(false))
}

pub(super) fn backup(source: &Path, directory: &Path, canceled: &AtomicBool) -> Result<PathBuf> {
    create_directory(directory)?;
    let date = OffsetDateTime::now_utc().format(format_description!(
        "[year][month][day]T[hour][minute][second].[subsecond digits:9]"
    ))?;
    let path = directory.join(format!("world-{date}.sqlite"));
    let temporary_path = with_suffix(&path, ".tmp");
    File::create_new(&temporary_path)?;
    let result = (|| -> Result<()> {
        let mut source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let transaction = source.transaction()?;
        // Pin a single WAL snapshot while the destination is copied in pages.
        transaction.query_row("SELECT id FROM world WHERE id=1", [], |_| Ok(()))?;
        let mut destination = Connection::open(&temporary_path)?;
        let backup = Backup::new(&transaction, &mut destination)?;
        loop {
            if canceled.load(Ordering::Acquire) {
                return Err(
                    io::Error::new(io::ErrorKind::Interrupted, "world backup canceled").into(),
                );
            }
            if matches!(backup.step(BACKUP_PAGES_PER_STEP)?, StepResult::Done) {
                break;
            }
            thread::park_timeout(BACKUP_STEP_DELAY);
        }
        drop(backup);
        destination.close().map_err(|(_, error)| error)?;
        fs::rename(&temporary_path, &path)?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    let mut backups = periodic_backups(directory)?;
    backups.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
    let remove_count = backups.len().saturating_sub(RETAINED_BACKUPS);
    for (backup, _) in backups.into_iter().take(remove_count) {
        fs::remove_file(backup)?;
    }
    Ok(path)
}

/// Keep the world files and sidecars together in a new archive.
pub fn reset(path: &Path) -> Result<PathBuf> {
    let _lock = lock_database(path).map_err(|error| {
        format!(
            "stop the game server before resetting {}: {error}",
            path.display()
        )
    })?;
    let base = path.file_name().ok_or("missing database filename")?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let directory = directory_of(path);
    let archive = (0..)
        .find_map(|attempt: u128| {
            let name = with_suffix(Path::new(base), &format!(".reset-{}", timestamp + attempt));
            let archive = directory.join(name);
            match DirBuilder::new().mode(0o700).create(&archive) {
                Ok(()) => Some(Ok(archive)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(error)),
            }
        })
        .ok_or("unable to allocate a world archive")??;

    let mut moved = Vec::with_capacity(3);
    for suffix in ["", "-wal", "-shm"] {
        let original = with_suffix(path, suffix);
        let archived = archive.join(with_suffix(Path::new(base), suffix));
        match fs::rename(&original, &archived) {
            Ok(()) => moved.push((original, archived)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                let mut message = error.to_string();
                for (original, archived) in moved.into_iter().rev() {
                    if let Err(rollback) = fs::rename(archived, original) {
                        message.push_str(&format!("; rollback failed: {rollback}"));
                    }
                }
                return Err(message.into());
            }
        }
    }
    Ok(archive)
}

#[derive(Clone, Copy)]
pub enum BackupAction<'a> {
    List,
    Delete(&'a Path),
    DeleteAll,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum BackupKind {
    Periodic,
    Reset,
}

struct BackupEntry {
    path: PathBuf,
    kind: BackupKind,
    allocated: u64,
    modified: SystemTime,
}

pub fn manage_backups(
    database: &Path,
    directory: &Path,
    action: BackupAction<'_>,
    output: &mut impl Write,
) -> Result<()> {
    let entries = backup_inventory(database, directory)?;
    print_backups(database, &entries, output)?;
    let selected = match action {
        BackupAction::List => return Ok(()),
        BackupAction::Delete(path) => {
            let absolute = std::path::absolute(path)?;
            let entry = entries
                .into_iter()
                .find(|entry| entry.path == absolute)
                .ok_or_else(|| {
                    format!(
                        "not a listed backup: {}; copy a full path from the backup listing",
                        path.display()
                    )
                })?;
            vec![entry]
        }
        BackupAction::DeleteAll => entries,
    };

    let base = database.file_name().ok_or("missing database filename")?;
    let allowed = [
        PathBuf::from(base),
        with_suffix(Path::new(base), "-wal"),
        with_suffix(Path::new(base), "-shm"),
    ];
    // Check every candidate before starting the inventory operation.
    let mut contents = Vec::with_capacity(selected.len());
    for entry in &selected {
        let metadata = fs::symlink_metadata(&entry.path)?;
        let mut files = Vec::new();
        match entry.kind {
            BackupKind::Periodic if metadata.is_file() => {}
            BackupKind::Reset if metadata.is_dir() => {
                for file in fs::read_dir(&entry.path)? {
                    let file = file?;
                    if !file.file_type()?.is_file()
                        || !allowed.contains(&PathBuf::from(file.file_name()))
                    {
                        return Err(format!(
                            "refusing to delete archive with unexpected content: {}",
                            entry.path.display()
                        )
                        .into());
                    }
                    files.push(file.path());
                }
            }
            _ => return Err(format!("backup type changed: {}", entry.path.display()).into()),
        }
        contents.push(files);
    }
    for (entry, files) in selected.iter().zip(contents) {
        match entry.kind {
            BackupKind::Periodic => fs::remove_file(&entry.path)?,
            BackupKind::Reset => {
                for file in files {
                    fs::remove_file(file)?;
                }
                fs::remove_dir(&entry.path)?;
            }
        }
        writeln!(output, "Deleted {}", entry.path.display())?;
    }
    writeln!(output, "\nAfter deleting {} backup(s):", selected.len())?;
    print_backups(database, &backup_inventory(database, directory)?, output)
}

fn entries(path: &Path) -> io::Result<Vec<fs::DirEntry>> {
    match fs::read_dir(path) {
        Ok(entries) => entries.collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn periodic_backups(directory: &Path) -> io::Result<Vec<(PathBuf, Metadata)>> {
    let mut backups = Vec::new();
    for file in entries(directory)? {
        let name = file.file_name();
        let Some(stamp) = name
            .as_bytes()
            .strip_prefix(b"world-")
            .and_then(|name| name.strip_suffix(b".sqlite"))
        else {
            continue;
        };
        if stamp.len() == 25
            && stamp[8] == b'T'
            && stamp[15] == b'.'
            && [&stamp[..8], &stamp[9..15], &stamp[16..]]
                .into_iter()
                .flatten()
                .all(u8::is_ascii_digit)
            && file.file_type()?.is_file()
        {
            backups.push((file.path(), file.metadata()?));
        }
    }
    Ok(backups)
}

fn backup_inventory(database: &Path, directory: &Path) -> Result<Vec<BackupEntry>> {
    let mut protected = Vec::new();
    for suffix in ["", "-wal", "-shm", ".lock"] {
        match fs::metadata(with_suffix(database, suffix)) {
            Ok(info) => protected.push((info.dev(), info.ino())),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let mut periodic = periodic_backups(directory)?;
    periodic.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
    let base = database.file_name().ok_or("missing database filename")?;
    let prefix = with_suffix(Path::new(base), ".reset-");
    let mut resets = Vec::new();
    for file in entries(directory_of(database))? {
        let name = file.file_name();
        let Some(suffix) = name.as_bytes().strip_prefix(prefix.as_os_str().as_bytes()) else {
            continue;
        };
        if !suffix.is_empty() && suffix.iter().all(u8::is_ascii_digit) && file.file_type()?.is_dir()
        {
            resets.push((file.path(), file.metadata()?));
        }
    }
    resets.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
    let mut backups = Vec::new();
    for (kind, files) in [
        (BackupKind::Periodic, periodic),
        (BackupKind::Reset, resets),
    ] {
        for (path, metadata) in files {
            if protected.contains(&(metadata.dev(), metadata.ino())) {
                continue;
            }
            let allocated = if kind == BackupKind::Reset {
                disk_bytes(&path)?
            } else {
                metadata.blocks() * 512
            };
            backups.push(BackupEntry {
                path: std::path::absolute(path)?,
                kind,
                allocated,
                modified: metadata.modified()?,
            });
        }
    }
    Ok(backups)
}

fn disk_bytes(path: &Path) -> io::Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    let mut allocated = metadata.blocks() * 512;
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            allocated += disk_bytes(&entry?.path())?;
        }
    }
    Ok(allocated)
}

fn print_backups(database: &Path, backups: &[BackupEntry], output: &mut impl Write) -> Result<()> {
    let mut periodic = 0;
    let mut total = 0;
    for entry in backups {
        let date = OffsetDateTime::from(entry.modified).format(format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second]Z"
        ))?;
        let kind = match entry.kind {
            BackupKind::Periodic => {
                periodic += 1;
                "periodic"
            }
            BackupKind::Reset => "reset",
        };
        total += entry.allocated;
        writeln!(
            output,
            "{kind}  {date}  {}  {}",
            storage_size(entry.allocated),
            entry.path.display()
        )?;
    }
    let count = backups.len();
    writeln!(
        output,
        "Backups: {count} ({periodic} periodic, {} reset archives); disk space used: {}",
        count - periodic,
        storage_size(total)
    )?;
    let directory = directory_of(database);
    let path = CString::new(directory.as_os_str().as_bytes())?;
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: statfs writes a complete statfs struct on success. Both pointers
    // are valid for the call, and the path is NUL-terminated by CString.
    let stats = unsafe {
        if libc::statfs(path.as_ptr(), stats.as_mut_ptr()) != 0 {
            return Err(io::Error::last_os_error().into());
        }
        stats.assume_init()
    };
    let size = stats.f_bsize as u64;
    writeln!(
        output,
        "Volume {}: {} available, {} used, {} total",
        directory.display(),
        storage_size(stats.f_bavail * size),
        storage_size((stats.f_blocks - stats.f_bfree) * size),
        storage_size(stats.f_blocks * size)
    )?;
    Ok(())
}

fn storage_size(bytes: u64) -> String {
    let mut value = bytes as f64;
    let mut unit = 0;
    let units = ["B", "KiB", "MiB", "GiB", "TiB"];
    while value >= 1024.0 && unit < units.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.2} {} ({bytes} bytes)", units[unit])
}
