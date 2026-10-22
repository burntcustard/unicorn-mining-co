// Exercise kernel backpressure and private transport invariants without adding
// diagnostic hooks or generated tests to the production server.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'unicorn-transport-check-'));
const source = String.raw`package network

import (
 "bytes"
 "bufio"
 "encoding/binary"
 "fmt"
 "io"
 "net"
 "os"
 "sync"
 "testing"
 "time"
 "golang.org/x/sys/unix"
 "github.com/burntcustard/unicorn-mining-co/src/server/protocol"
 "github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func transportPair(t *testing.T) (*WebSocket, net.Conn) {
 t.Helper()
 fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM|unix.SOCK_NONBLOCK|unix.SOCK_CLOEXEC, 0)
 if err != nil { t.Fatal(err) }
 if err := unix.SetsockoptInt(fds[0], unix.SOL_SOCKET, unix.SO_SNDBUF, 4096); err != nil { t.Fatal(err) }
 connections := [2]net.Conn{}
 for i, fd := range fds {
  file := os.NewFile(uintptr(fd), "transport-check")
  connections[i], err = net.FileConn(file)
  file.Close()
  if err != nil { t.Fatal(err) }
  t.Cleanup(func() { connections[i].Close() })
 }
 socket := &WebSocket{conn:connections[0], queue:make(chan outbound,1024), spare:make(chan []byte,1), done:make(chan struct{})}
 socket.direct = newDirectSender(connections[0])
 if socket.direct == nil { t.Fatal("missing Linux direct sender") }
 t.Cleanup(socket.Terminate)
 connections[1].SetDeadline(time.Now().Add(5*time.Second))
 return socket, connections[1]
}

func TestTransportKernelPartialWrite(t *testing.T) {
 socket, client := transportPair(t)
 if err := socket.SendBinary([]byte("fast")); err != nil { t.Fatal(err) }
 if len(socket.queue)!=0 || socket.BufferedBytes()!=0 { t.Fatal("small write did not complete directly") }
 reader := bufio.NewReader(client)
 _, payload, err := readServerFrame(reader)
 if err!=nil || string(payload)!="fast" { t.Fatal("fast frame",err) }
 packet := bytes.Repeat([]byte{0xa7},32768)
 started := time.Now()
 if err := socket.SendBinary(packet); err != nil { t.Fatal(err) }
 if time.Since(started)>time.Second { t.Fatal("nonblocking send waited for the reader") }
 frame := <-socket.queue
 if frame.offset<=0 || frame.offset>=len(frameBytes(frame.opcode,frame.data)) { t.Fatalf("expected a partial write, offset=%d",frame.offset) }
 socket.queue <- frame
 for i := range packet { packet[i]=0 }
 if err:=socket.Ping();err!=nil {t.Fatal(err)}
 if err:=socket.SendBinary([]byte("tail"));err!=nil {t.Fatal(err)}
 socket.CloseWith(1000,"done")
 if socket.pending.Load()!=4 {t.Fatal("control frames missing from ordering counter")}
 go socket.writePump()
 for index, opcode := range []byte{OpBinary,OpPing,OpBinary,OpClose} {
  kind,data,err:=readServerFrame(reader)
  if err!=nil || kind!=opcode {t.Fatalf("frame %d: kind=%d err=%v",index,kind,err)}
  switch index {
  case 0: if !bytes.Equal(data,bytes.Repeat([]byte{0xa7},32768)) {t.Fatal("partial write changed copied payload")}
  case 1: if len(data)!=0 {t.Fatal("ping payload")}
  case 2: if string(data)!="tail" {t.Fatal("queued frame was overtaken")}
  case 3: if binary.BigEndian.Uint16(data)!=1000 || string(data[2:])!="done" {t.Fatal("close frame")}
  }
 }
 select {case <-socket.Done():case <-time.After(time.Second):t.Fatal("close did not terminate")}
 if socket.BufferedBytes()!=0 || socket.pending.Load()!=0 {t.Fatal("completed frames retained reservations")}
}

func TestTransportKernelFullBuffer(t *testing.T) {
 socket,client:=transportPair(t)
 filler:=bytes.Repeat([]byte{0x6a},32768)
 total:=0
 for {
  count,err:=socket.direct.send(filler)
  if err!=nil {t.Fatal(err)}
  total+=count
  if count==0 {break}
 }
 if total==0 {t.Fatal("failed to fill socket")}
 if err:=socket.SendBinary([]byte("after EAGAIN"));err!=nil {t.Fatal(err)}
 frame:=<-socket.queue
 if frame.offset!=0 {t.Fatal("EAGAIN must queue the complete frame")}
 socket.queue<-frame
 go socket.writePump()
 if _,err:=io.CopyN(io.Discard,client,int64(total));err!=nil {t.Fatal(err)}
 _,payload,err:=readServerFrame(bufio.NewReader(client))
 if err!=nil || string(payload)!="after EAGAIN" {t.Fatal("EAGAIN fallback",err)}
}

func TestTransportKernelPartialHeaders(t *testing.T) {
 for _,cut:=range []int{1,2,3,4,9,10,11} {
  socket,client:=transportPair(t)
  original:=socket.direct.callback
  socket.direct.callback=func(fd uintptr){
   data:=socket.direct.data
   socket.direct.data=data[:cut]
   original(fd)
   socket.direct.data=data
  }
  packet:=bytes.Repeat([]byte{0x5d},70000)
  if err:=socket.SendBinary(packet);err!=nil {t.Fatal(err)}
  frame:=<-socket.queue
  if frame.offset!=cut {t.Fatalf("cut %d: offset=%d",cut,frame.offset)}
  socket.queue<-frame
  go socket.writePump()
  kind,data,err:=readServerFrame(bufio.NewReader(client))
  if err!=nil || kind!=OpBinary || !bytes.Equal(data,packet) {t.Fatalf("cut %d corrupted frame: %v",cut,err)}
 }
}

func TestTransportKernelInterruptedAndClosed(t *testing.T) {
 socket,client:=transportPair(t)
 socket.direct.callback=func(uintptr){socket.direct.count=-1;socket.direct.sendError=unix.EINTR}
 if err:=socket.SendBinary([]byte("interrupted"));err!=nil {t.Fatal(err)}
 go socket.writePump()
 _,data,err:=readServerFrame(bufio.NewReader(client))
 if err!=nil || string(data)!="interrupted" {t.Fatal("EINTR fallback",err)}
 socket,client=transportPair(t)
 client.Close()
 if err:=socket.SendBinary([]byte("closed"));err==nil {t.Fatal("closed peer accepted a frame")}
 select {case <-socket.Done():default:t.Fatal("closed peer did not terminate")}
 if socket.BufferedBytes()!=0 || socket.pending.Load()!=0 {t.Fatal("failed direct write retained reservations")}
}

func TestTransportKernelConcurrentWrites(t *testing.T) {
 socket,client:=transportPair(t)
 go socket.writePump()
 failures:=make(chan error,1)
 go func(){
  expected:=[8]int{}
  reader:=bufio.NewReader(client)
  for range 8*64 {
   kind,data,err:=readServerFrame(reader)
   if err!=nil {failures<-err;return}
   if kind!=OpBinary || len(data)!=1024 || data[0]>=8 || int(data[1])!=expected[data[0]] || !bytes.Equal(data[2:],bytes.Repeat(data[:1],1022)) {failures<-fmt.Errorf("corrupt or reordered concurrent frame");return}
   expected[data[0]]++
  }
  failures<-nil
 }()
 var wait sync.WaitGroup
 for producer:=range 8 {
  wait.Go(func(){
   packet:=bytes.Repeat([]byte{byte(producer)},1024)
   for sequence:=range 64 {
    packet[1]=byte(sequence)
    if err:=socket.SendBinary(packet);err!=nil {t.Error(err);return}
   }
  })
 }
 wait.Wait()
 if err:=<-failures;err!=nil {t.Fatal(err)}
}

func TestTransportReceiptJitter(t *testing.T) {
 catalog,err:=specs.Load()
 if err!=nil {t.Fatal(err)}
 for _,latencies:=range [][]uint64{{2},{6},{8},{18},{2,4,3,2},{2,8,3,1},{1,2,10,2}} {
  session:=NewGameSession(25,catalog)
  socket:=&benchmarkSocket{}
  session.Receive(protocol.Control{Type:"hello"},socket)
  player:=session.playersBySocket[socket]
  type receipt struct{at,sequence uint64}
  receipts:=[]receipt{{latencies[0],socket.sequence}}
  snapshots,requests:=0,0
  longestGap,gap:=0,0
  for tick:=0;tick<180;tick++ {
   for i:=0;i<len(receipts); {
    if receipts[i].at<=session.World.Tick {
     session.Receive(protocol.Control{Type:"snapshotAck",Sequence:receipts[i].sequence},socket)
     receipts=append(receipts[:i],receipts[i+1:]...)
    } else {i++}
   }
   previous,previousReceipt:=socket.packets,socket.sequence
   session.Receive(protocol.Control{Type:"input",Tick:session.World.Tick,Sequence:uint64(tick+1),Input:protocol.Input{Turn:float64(tick%3-1)}},socket)
   session.Tick(1)
   if player.lastSequence!=uint64(tick+1) {t.Fatal("receipt pacing delayed an input")}
   if socket.sequence!=previousReceipt {
    receipts=append(receipts,receipt{session.World.Tick+latencies[requests%len(latencies)],socket.sequence})
    requests++
   }
   if session.World.Tick>60 {
    if socket.packets!=previous {snapshots++;gap=0} else {gap++;longestGap=max(longestGap,gap)}
   }
  }
  t.Logf("latencies=%v snapshots=%d requests=%d longestGap=%d",latencies,snapshots,requests,longestGap)
  if (len(latencies)>1 || latencies[0]<=8) && snapshots!=120 {t.Fatal("receipt pacing lost snapshot cadence")}
  if len(player.pendingSnapshots)>16 {t.Fatal("receipt pacing exceeded its bounded allowance")}
 }
}
`;

try {
  const file = join(directory, 'transport_check_test.go');

  writeFileSync(file, source);
  const base = process.env.GO_CHECK_OVERLAY
    ? JSON.parse(readFileSync(process.env.GO_CHECK_OVERLAY, 'utf8')).Replace
    : {};
  const overlay = join(directory, 'overlay.json');

  writeFileSync(
    overlay,
    JSON.stringify({
      Replace: {
        ...base,
        [resolve('src/server/network/transport_check_test.go')]: file,
      },
    }),
  );

  execFileSync(
    'go',
    [
      'test',
      '-overlay',
      overlay,
      ...(process.argv.includes('--race') ? ['-race'] : []),
      './src/server/network',
      '-run',
      '^TestTransport(Kernel|Receipt)',
      '-count=1',
      '-v',
    ],
    {
      env: {
        ...process.env,
        GOEXPERIMENT: process.env.GOEXPERIMENT || 'simd',
        CGO_ENABLED: process.argv.includes('--race') ? '1' : '0',
      },
      stdio: 'inherit',
    },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
