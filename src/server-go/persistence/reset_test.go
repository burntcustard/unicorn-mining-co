package persistence

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestResetArchivesDatabaseAndSidecars(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")

	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.WriteFile(path+suffix, []byte("saved"+suffix), 0600); err != nil {
			t.Fatal(err)
		}
	}

	archive, err := Reset(path)

	if err != nil {
		t.Fatal(err)
	}

	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, err := os.Stat(path + suffix); !os.IsNotExist(err) {
			t.Fatal("old database files remain", err)
		}

		data, err := os.ReadFile(filepath.Join(archive, "world.sqlite"+suffix))

		if err != nil || string(data) != "saved"+suffix {
			t.Fatal("archive did not preserve the file", err)
		}
	}
}

func TestResetRefusesRunningServer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")

	if err := os.WriteFile(path, []byte("saved"), 0600); err != nil {
		t.Fatal(err)
	}

	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)

	if err != nil {
		t.Fatal(err)
	}

	defer lock.Close()

	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}

	if _, err := Reset(path); err == nil {
		t.Fatal("reset must refuse the server's exclusive lock")
	}

	if data, err := os.ReadFile(path); err != nil || string(data) != "saved" {
		t.Fatal("refused reset changed the database", err)
	}
}
