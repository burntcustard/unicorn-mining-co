package persistence

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func backupFixture(t *testing.T) (BackupOptions, string, string) {
	t.Helper()
	directory := t.TempDir()

	options := BackupOptions{
		DatabasePath: filepath.Join(directory, "world.sqlite"),
		Directory:    filepath.Join(directory, "backups"),
		Output:       &bytes.Buffer{},
	}

	archive := options.DatabasePath + ".reset-12345"
	periodic := filepath.Join(options.Directory, "world-20261012T120000.000000000.sqlite")

	for _, path := range []string{options.Directory, archive} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}

	for _, path := range []string{
		options.DatabasePath, options.DatabasePath + "-wal", options.DatabasePath + "-shm", options.DatabasePath + ".lock",
		periodic, periodic + ".tmp", filepath.Join(options.Directory, "notes.txt"),
		filepath.Join(archive, "world.sqlite"), filepath.Join(archive, "world.sqlite-wal"), filepath.Join(archive, "world.sqlite-shm"),
	} {
		if err := os.WriteFile(path, []byte("saved data"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	return options, periodic, archive
}

func TestBackupsReportAllocatedSpaceAndIgnoreIncompleteFiles(t *testing.T) {
	options, periodic, archive := backupFixture(t)
	link := filepath.Join(options.Directory, "world-20261012T120001.000000000.sqlite")

	if err := os.Symlink(options.DatabasePath, link); err != nil {
		t.Fatal(err)
	}

	backups, err := findBackups(options)

	if err != nil || len(backups) != 2 {
		t.Fatal("expected one completed backup and one reset archive", backups, err)
	}

	if backups[0].path != periodic || backups[1].path != archive {
		t.Fatal("wrong inventory", backups)
	}

	info, err := os.Stat(periodic)

	if err != nil {
		t.Fatal(err)
	}

	if backups[0].allocated != info.Sys().(*syscall.Stat_t).Blocks*512 {
		t.Fatal("report must measure allocated blocks, not file length")
	}

	if err := ManageBackups(options); err != nil {
		t.Fatal(err)
	}

	output := options.Output.(*bytes.Buffer).String()

	for _, expected := range []string{"Backups: 2 (1 periodic, 1 reset archives)", "disk space used:", "available,", "used,", "total", periodic, archive} {
		if !strings.Contains(output, expected) {
			t.Fatalf("missing %q in %s", expected, output)
		}
	}
}

func TestBackupDeletionPreservesLiveDatabaseAndIncompleteFiles(t *testing.T) {
	for _, target := range []string{"periodic", "reset", "all"} {
		t.Run(target, func(t *testing.T) {
			options, periodic, archive := backupFixture(t)
			lock, err := os.OpenFile(options.DatabasePath+".lock", os.O_RDWR, 0600)

			if err != nil {
				t.Fatal(err)
			}

			defer lock.Close()

			if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
				t.Fatal(err)
			}

			switch target {
			case "periodic":
				options.DeletePath = periodic
			case "reset":
				options.DeletePath = archive
			case "all":
				options.DeleteAll = true
			}

			if err := ManageBackups(options); err != nil {
				t.Fatal("maintenance must work while the game holds its lock", err)
			}

			for _, path := range []string{periodic, archive} {
				_, err := os.Stat(path)
				deleted := target == "all" || path == options.DeletePath

				if deleted != os.IsNotExist(err) {
					t.Fatalf("unexpected deletion state for %s: %v", path, err)
				}
			}

			for _, path := range []string{options.DatabasePath, options.DatabasePath + "-wal", options.DatabasePath + "-shm", options.DatabasePath + ".lock", periodic + ".tmp", filepath.Join(options.Directory, "notes.txt")} {
				if data, err := os.ReadFile(path); err != nil || string(data) != "saved data" {
					t.Fatal("maintenance modified a protected file", path, err)
				}
			}

			output := options.Output.(*bytes.Buffer).String()

			if strings.Count(output, "Volume ") != 2 || !strings.Contains(output, "After deleting") {
				t.Fatal("deletion must report disk usage before and after", output)
			}
		})
	}
}

func TestBackupDeletionRejectsUnlistedPaths(t *testing.T) {
	options, periodic, archive := backupFixture(t)

	for _, path := range []string{options.DatabasePath, options.Directory, filepath.Dir(options.DatabasePath), periodic + ".tmp", archive + "/world.sqlite", filepath.Join(options.Directory, "missing.sqlite")} {
		options.DeletePath = path

		if err := ManageBackups(options); err == nil {
			t.Fatal("must reject unlisted path", path)
		}
	}

	for _, path := range []string{options.DatabasePath, periodic, filepath.Join(archive, "world.sqlite")} {
		if data, err := os.ReadFile(path); err != nil || string(data) != "saved data" {
			t.Fatal("rejected command deleted data", path, err)
		}
	}
}

func TestBackupDeletionValidatesAllArchivesBeforeDeleting(t *testing.T) {
	for _, unexpected := range []string{"file", "symlink"} {
		t.Run(unexpected, func(t *testing.T) {
			options, periodic, archive := backupFixture(t)
			path := filepath.Join(archive, "world.sqlite-wal")

			if unexpected == "file" {
				if err := os.WriteFile(filepath.Join(archive, "unrelated.txt"), []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}

				if err := os.Symlink(options.DatabasePath, path); err != nil {
					t.Fatal(err)
				}
			}

			options.DeleteAll = true

			if err := ManageBackups(options); err == nil || !strings.Contains(err.Error(), "unexpected content") {
				t.Fatal("must refuse unexpected archive content", err)
			}

			if _, err := os.Stat(periodic); err != nil {
				t.Fatal("validation failure must preserve all backups", err)
			}
		})
	}
}

func TestBackupsProtectActiveDatabaseWithBackupFilename(t *testing.T) {
	options, periodic, _ := backupFixture(t)
	options.DatabasePath = periodic
	options.DeleteAll = true

	if err := ManageBackups(options); err != nil {
		t.Fatal(err)
	}

	if data, err := os.ReadFile(periodic); err != nil || string(data) != "saved data" {
		t.Fatal("active database must be excluded even if its name matches a backup", err)
	}
}

func TestBackupsWithNoBackupDirectory(t *testing.T) {
	options := BackupOptions{
		DatabasePath: filepath.Join(t.TempDir(), "world.sqlite"),
		Directory:    filepath.Join(t.TempDir(), "missing"),
		DeleteAll:    true,
		Output:       &bytes.Buffer{},
	}

	if err := ManageBackups(options); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(options.Output.(*bytes.Buffer).String(), "Backups: 0") {
		t.Fatal("empty backup storage should still report zero and disk capacity")
	}
}
