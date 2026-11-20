package network

import "testing"

func TestStringFieldCachePreservesChangesWithoutAllocating(t *testing.T) {
	record := &binaryRecord{fields: make([]fieldState, 2)}
	reference := &binaryRecord{fields: make([]fieldState, 2)}

	for _, value := range []any{"Pirate", "Pirate", "Fighting", "", nil, "", false, "Collecting"} {
		if text, ok := value.(string); ok {
			scalarString(record, 1, text)
		} else {
			scalar(record, 1, value)
		}

		scalar(reference, 1, value)

		if record.revision != reference.revision || record.fields[1] != reference.fields[1] {
			t.Fatalf("value %v: got %+v rev%d want %+v rev%d", value, record.fields[1], record.revision, reference.fields[1], reference.revision)
		}
	}

	value := record.fields[1].wire.(string)

	if allocations := testing.AllocsPerRun(100, func() { scalarString(record, 1, value) }); allocations != 0 {
		t.Fatalf("unchanged text allocated %g times", allocations)
	}
}
