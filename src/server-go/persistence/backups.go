package persistence

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

type BackupOptions struct {
	DatabasePath string
	Directory    string
	DeletePath   string
	DeleteAll    bool
	Output       io.Writer
}

type savedBackup struct {
	path      string
	kind      string
	allocated int64
	modified  string
}

// ManageBackups reports completed SQLite backups and reset archives without
// opening the live database. Deletion is limited to entries in that inventory.
func ManageBackups(options BackupOptions) error {
	if options.DeletePath != "" && options.DeleteAll {
		return fmt.Errorf("choose one backup path or all backups")
	}

	backups, err := findBackups(options)

	if err != nil {
		return err
	}

	if err := printBackups(options, backups); err != nil {
		return err
	}

	if options.DeletePath == "" && !options.DeleteAll {
		return nil
	}

	selected := backups

	if !options.DeleteAll {
		path, err := filepath.Abs(options.DeletePath)

		if err != nil {
			return err
		}

		selected = nil

		for _, backup := range backups {
			if backup.path == path {
				selected = append(selected, backup)
			}
		}

		if len(selected) != 1 {
			return fmt.Errorf("not a listed backup: %s; copy a full path from the backup listing", options.DeletePath)
		}
	}

	// Validate every target before removing any. Reset archives should contain
	// only the old database and its sidecars; unexpected content is preserved.
	for _, backup := range selected {
		info, err := os.Lstat(backup.path)

		if err != nil {
			return err
		}

		if backup.kind == "periodic" && !info.Mode().IsRegular() {
			return fmt.Errorf("backup is no longer a regular file: %s", backup.path)
		}

		if backup.kind == "reset" {
			if !info.IsDir() {
				return fmt.Errorf("archive is no longer a directory: %s", backup.path)
			}

			entries, err := os.ReadDir(backup.path)

			if err != nil {
				return err
			}

			for _, entry := range entries {
				name := entry.Name()
				base := filepath.Base(options.DatabasePath)
				info, err := entry.Info()

				if err != nil {
					return err
				}

				if (name != base && name != base+"-wal" && name != base+"-shm") || !info.Mode().IsRegular() {
					return fmt.Errorf("refusing to delete archive with unexpected content: %s", backup.path)
				}
			}
		}
	}

	for _, backup := range selected {
		if err := os.RemoveAll(backup.path); err != nil {
			return err
		}

		fmt.Fprintf(options.Output, "Deleted %s\n", backup.path)
	}

	fmt.Fprintf(options.Output, "\nAfter deleting %d backup(s):\n", len(selected))
	remaining, err := findBackups(options)

	if err != nil {
		return err
	}

	return printBackups(options, remaining)
}

func findBackups(options BackupOptions) ([]savedBackup, error) {
	periodic := regexp.MustCompile(`^world-[0-9]{8}T[0-9]{6}\.[0-9]{9}\.sqlite$`)
	archive := regexp.MustCompile("^" + regexp.QuoteMeta(filepath.Base(options.DatabasePath)) + `\.reset-[0-9]+$`)
	backups := []savedBackup{}
	protected := []os.FileInfo{}

	for _, suffix := range []string{"", "-wal", "-shm", ".lock"} {
		info, err := os.Stat(options.DatabasePath + suffix)

		if err == nil {
			protected = append(protected, info)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}

	for _, source := range []struct {
		directory string
		kind      string
		pattern   *regexp.Regexp
	}{
		{options.Directory, "periodic", periodic},
		{filepath.Dir(options.DatabasePath), "reset", archive},
	} {
		entries, err := os.ReadDir(source.directory)

		if os.IsNotExist(err) {
			continue
		}

		if err != nil {
			return nil, err
		}

		for _, entry := range entries {
			if !source.pattern.MatchString(entry.Name()) {
				continue
			}

			info, err := entry.Info()

			if err != nil {
				return nil, err
			}

			if (source.kind == "periodic" && !info.Mode().IsRegular()) || (source.kind == "reset" && !info.IsDir()) {
				continue
			}

			live := false

			for _, active := range protected {
				live = live || os.SameFile(active, info)
			}

			if live {
				continue
			}

			path, err := filepath.Abs(filepath.Join(source.directory, entry.Name()))

			if err != nil {
				return nil, err
			}

			var allocated int64

			if err := filepath.WalkDir(path, func(path string, entry fs.DirEntry, err error) error {
				if err != nil {
					return err
				}

				info, err := entry.Info()

				if err != nil {
					return err
				}

				allocated += info.Sys().(*syscall.Stat_t).Blocks * 512
				return nil
			}); err != nil {
				return nil, err
			}

			backups = append(backups, savedBackup{path, source.kind, allocated, info.ModTime().UTC().Format("2006-01-02T15:04:05Z")})
		}
	}

	return backups, nil
}

func printBackups(options BackupOptions, backups []savedBackup) error {
	var total int64
	var periodic, reset int

	for _, backup := range backups {
		total += backup.allocated

		if backup.kind == "periodic" {
			periodic++
		} else {
			reset++
		}

		fmt.Fprintf(options.Output, "%s  %s  %s  %s\n", backup.kind, backup.modified, storageSize(uint64(backup.allocated)), backup.path)
	}

	fmt.Fprintf(options.Output, "Backups: %d (%d periodic, %d reset archives); disk space used: %s\n", len(backups), periodic, reset, storageSize(uint64(total)))
	var disk syscall.Statfs_t
	path := filepath.Dir(options.DatabasePath)

	if err := syscall.Statfs(path, &disk); err != nil {
		return err
	}

	blockSize := uint64(disk.Bsize)
	fmt.Fprintf(options.Output, "Volume %s: %s available, %s used, %s total\n", path, storageSize(disk.Bavail*blockSize), storageSize((disk.Blocks-disk.Bfree)*blockSize), storageSize(disk.Blocks*blockSize))
	return nil
}

func storageSize(bytes uint64) string {
	value := float64(bytes)
	units := strings.Fields("B KiB MiB GiB TiB")
	unit := 0

	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}

	return fmt.Sprintf("%.2f %s (%d bytes)", value, units[unit], bytes)
}
