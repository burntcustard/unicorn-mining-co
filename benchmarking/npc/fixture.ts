// Provision local NPC scenes through a compiler overlay, never production hooks.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fixture = String.raw`package network

import (
 "encoding/json"
 "fmt"
 "maps"
 "math"
 "math/rand/v2"
 "os"
 "path/filepath"
 "slices"
 "strconv"
 "strings"
 "time"
 "github.com/burntcustard/unicorn-mining-co/src/server/objects"
 ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
 "github.com/burntcustard/unicorn-mining-co/src/server/protocol"
 "github.com/burntcustard/unicorn-mining-co/src/server/simulation"
 Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type collectorBenchmarkEvent struct {
 At int64
 Kind string
 ShipID int64
 ItemID int64
}

type collectorBenchmarkEncounter struct {
 player *playerRecord
 sectorID string
 homeID int64
 scenario string
 seed *uint32
 layout []Vec.Vector
 itemIDs map[int64]bool
 shipIDs map[int64]bool
 existingShips map[int64]bool
 previousStation json.RawMessage
 previousRegions map[Vec.Vector]bool
 events []collectorBenchmarkEvent
 startedAt int64
 maximumActive int
 collectionStarted bool
 dockedTick *uint64
 saved bool
}

var collectorBenchmarkEncounters = map[*simulation.World]*collectorBenchmarkEncounter{}
var collectionBenchmarkSlots = map[*playerRecord]uint64{}
var collectionBenchmarkSeeds = map[*playerRecord]uint32{}
var npcBenchmarkAnchors = map[*simulation.World]*objects.Ship{}

func npcBenchmarkViewer(p *playerRecord) bool {
 return p!=nil&&p.ship.PlayerID==nil&&strings.HasPrefix(p.ship.Name,"Fixture ")
}

// The compatibility anchor exists only in the protocol view. Neither the
// authoritative world nor its player/physics registries ever owns this body.
func npcBenchmarkEntities(world *simulation.World) []simulation.Entity {
 entities:=world.Entities.ReadValues()
 if anchor:=npcBenchmarkAnchors[world];anchor!=nil {return append(slices.Clone(entities),anchor)}
 return entities
}

func npcBenchmarkScenario(name string) string {
 return map[string]string{"Collect active":"collector","Collect empty":"collector-empty","Collect idle":"collector-idle","Collect crowded":"collector-crowded","Crowd idle":"collector-crowded-idle","Gather Courser":"collection-courser","Gather Finch":"collection-finch"}[name]
}

func(s *GameSession) playNPCBenchmark(p *playerRecord) bool {
 if npcBenchmarkScenario(p.profile.DisplayName)=="" {return false}
 if npcBenchmarkViewer(p) {return true}
 p.playedAt=s.now()
 s.prepareCollectorBenchmark(p)
 s.sendSnapshot(p,nil,nil)
 return true
}

func(s *GameSession) seedCollectionBenchmark(message protocol.Control, socket SessionSocket) bool {
 if message.Type=="chat"&&strings.HasPrefix(message.Text,"/npc-benchmark-slot ") {
  if p:=s.playersBySocket[socket];p!=nil&&p.playedAt.IsZero() {
   if slot,err:=strconv.ParseUint(strings.TrimPrefix(message.Text,"/npc-benchmark-slot "),10,8);err==nil&&slot>0&&slot<=6 {collectionBenchmarkSlots[p]=slot}
  }
  return true
 }
 if message.Type!="chat"||!strings.HasPrefix(message.Text,"/npc-benchmark-seed ") {return false}
 if p:=s.playersBySocket[socket];p!=nil&&p.playedAt.IsZero() {
  if seed,err:=strconv.ParseUint(strings.TrimPrefix(message.Text,"/npc-benchmark-seed "),10,32);err==nil {collectionBenchmarkSeeds[p]=uint32(seed)}
 }
 return true
}

func(s *GameSession) prepareCollectorBenchmark(p *playerRecord) {
 seed,seeded:=collectionBenchmarkSeeds[p]
 delete(collectionBenchmarkSeeds,p)
 scenario:=npcBenchmarkScenario(p.profile.DisplayName)
 if scenario=="" {return}
 collection:=scenario=="collection-courser"||scenario=="collection-finch"
 if collectionBenchmarkSlots[p]>0 {
  delete(collectionBenchmarkSlots,p)
  // Every concurrent case starts with identical procedural geometry in its own
  // ordinary sector runtime. Retired worlds are discarded before the next run.
  for id,runtime:=range s.sectors {
   if strings.HasPrefix(id,"npc-benchmark-")&&npcBenchmarkAnchors[runtime.world]==nil {
    delete(collectorBenchmarkEncounters,runtime.world)
    delete(s.sectors,id)
   }
  }
  s.World.Entities.Delete(p.ship.ID)
  s.World.Players.Delete(p.playerID)
  original:=s.World.Specification.StartingSectorID
  sector:=s.sectorMap.Sectors[slices.IndexFunc(s.sectorMap.Sectors,func(sector simulation.Sector)bool{return sector.ID==original})]
  sector.ID=fmt.Sprintf("npc-benchmark-%d",p.shipID)
  s.sectorMap.Sectors=append(s.sectorMap.Sectors,sector)
  p.sectorID=sector.ID
  s.activateSector(sector.ID)
  p.needsLoad=true
 }
 world:=s.World
 home:=s.nearestStation(Vec.Vector{})
 if home.DefinitionID=="" {panic("collector benchmark requires a normal station")}
 homeID:=s.regions.IDOffset+int64(home.ID)
 s.World.Entities.Delete(p.ship.ID)
 s.World.Players.Delete(p.playerID)
 if s.persistence!=nil {delete(s.persistence.players,p)}
 p.ship=objects.CreateShip(world,objects.Properties{ObjectProperties:simulation.ObjectProperties{World:world,ID:&p.shipID,Position:home.Position,Name:new("Fixture "+scenario),Radius:new(0.)}})
 // Keeping the stock plans with zero surviving segments encodes zero hull
 // health for every plan; the client removes all hulls instead of rebuilding.
 p.ship.Segments=nil
 p.ship.Cockpit=nil
 p.hiddenShip=true
 npcBenchmarkAnchors[world]=p.ship
 p.lastInput=protocol.Input{}
 p.pirateAfter=world.Tick+uint64(3600/world.Specification.Simulation.SimulationStep)
 positions:=s.positions()
 s.regions.Sync(world,positions)
 encounter:=&collectorBenchmarkEncounter{player:p,sectorID:s.currentSector,homeID:homeID,scenario:scenario,itemIDs:map[int64]bool{},shipIDs:map[int64]bool{},existingShips:map[int64]bool{},startedAt:time.Now().UnixMilli()}
 count:=__ITEM_COUNT__
 if scenario=="collector-crowded"||scenario=="collector-crowded-idle" {count=48}
 if scenario=="collector-empty" {count=0}
 if scenario=="collection-courser" {count=world.Specification.ShipSpecs["courser"].CargoSpace}
 if scenario=="collection-finch" {count=world.Specification.ShipSpecs["finch"].CargoSpace}
 candidates:=[]Vec.Vector{}
 if collection {
  if !seeded {seed=1}
  encounter.seed=&seed
  random:=rand.New(rand.NewPCG(uint64(seed),0))
  // Draw x and y independently. Generate the same eight slots for either hull;
  // Finch uses the first six, without changing the random sequence or geometry.
  for attempt:=0;attempt<10000&&len(candidates)<8;attempt++ {
   offset:=Vec.Create(random.Float64()*2000-1000,random.Float64()*2000-1000)
   candidate:=Vec.Add(home.Position,offset)
   blocked:=false
   check:=func(entity simulation.Entity,_ int64) {
    object:=entity.Base()
    if object.ID==p.ship.ID||object.Kind!="asteroid"&&object.Kind!="station"&&object.Kind!="ship" {return}
    if Vec.DistanceSquared(candidate,object.Position)<math.Pow(object.Radius+100,2) {blocked=true}
   }
   world.Entities.ForEach(check)
   s.regions.Sleeping.ForEach(check)
   for _,other:=range candidates {if Vec.DistanceSquared(candidate,other)<120*120 {blocked=true}}
   if !blocked {
    candidates=append(candidates,candidate)
    encounter.layout=append(encounter.layout,offset)
   }
  }
  if len(candidates)!=8||count>8 {panic("collection fixture requires eight clear random item positions")}
 } else {
  // Preserve the existing five collector CPU fixtures and their item positions.
  for distance:=650.;distance<=1050.;distance+=80 {
   for angle:=-.65;angle<=.65;angle+=.13 {
    candidate:=Vec.Add(home.Position,Vec.Create(math.Cos(angle)*distance,math.Sin(angle)*distance))
    blocked:=false
    world.Entities.ForEach(func(entity simulation.Entity,_ int64){
     object:=entity.Base()
     if object.Kind!="asteroid"&&object.Kind!="station" {return}
     if Vec.DistanceSquared(candidate,object.Position)<math.Pow(object.Radius+45,2) {blocked=true}
    })
    if !blocked {candidates=append(candidates,candidate)}
   }
  }
 }
 if len(candidates)<count {panic(fmt.Sprintf("collector fixture needs %d clear item positions, found %d",count,len(candidates)))}
 for i:=0;i<count;i++ {
  id:=simulation.EntityID(world)
  item:=objects.NewItem("gold",simulation.ObjectProperties{World:world,ID:&id,Position:candidates[i]},world.Specification)
  simulation.AddEntity(world,item)
  encounter.itemIDs[id]=true
 }
 runtime:=s.sectors[s.currentSector]
 encounter.previousRegions=maps.Clone(runtime.collectors.Regions)
 runtime.collectors.ForEachShip(func(ship *objects.Ship) {encounter.existingShips[ship.ID]=true})
 var stations map[int64]json.RawMessage
 if err:=json.Unmarshal(runtime.collectors.CaptureDispatch(),&stations);err!=nil {panic(err)}
 if stations==nil {stations=map[int64]json.RawMessage{}}
 encounter.previousStation=stations[homeID]
 seen:=map[int64]bool{}
 checkAt:=world.Tick
 if scenario=="collection-courser"||scenario=="collection-finch" {
  checkAt=math.MaxUint64
 } else if scenario=="collector"||scenario=="collector-crowded" {
  // Prime only the initial age observation. Real dispatch, launch spacing,
  // steering, cargo capacity, pickup and sale continue unchanged.
  for id:=range encounter.itemIDs {seen[id]=true}
 } else if scenario=="collector-idle"||scenario=="collector-crowded-idle" {
  for id:=range encounter.itemIDs {seen[id]=true}
  checkAt+=uint64(180/world.Specification.Simulation.SimulationStep)
 }
 station,err:=json.Marshal(map[string]any{"Home":home,"Seen":seen,"CheckAt":checkAt})
 if err!=nil {panic(err)}
 stations[homeID]=station
 dispatch,err:=json.Marshal(stations)
 if err!=nil {panic(err)}
 if err=runtime.collectors.RestoreDispatch(dispatch);err!=nil {panic(err)}
 collectorBenchmarkEncounters[s.World]=encounter
 runtime.collectors.Dispatch()
 s.regions.Sync(world,positions)
}

// Start the controlled hatch comparison after the ordinary warmup. The same
// collector policy flies either ship; cargo capacity and geometry come from it.
func(s *GameSession) startCollectionBenchmark(p *playerRecord) {
 encounter:=collectorBenchmarkEncounters[s.World]
 if encounter==nil||encounter.player!=p||encounter.collectionStarted||encounter.saved {return}
 definition:=""
 if encounter.scenario=="collection-courser" {definition="courser"}
 if encounter.scenario=="collection-finch" {definition="finch"}
 if definition=="" {return}
 encounter.collectionStarted=true
 runtime:=s.sectors[s.currentSector]
 home:=runtime.collectors.Stations[encounter.homeID].Home
 ship:=ai.Spawn(runtime.collectors.Environment,ai.SpawnOptions{DefinitionID:definition,Name:"Collection "+definition,Home:home,Credits:new(0.)})
 hull,modules:=ai.Equipment(ship)
 items:=[]map[string]any{}
 ids:=[]int64{}
 for id:=range encounter.itemIDs {ids=append(ids,id)}
 slices.Sort(ids)
 for _,id:=range ids {
  item:=runtime.collectors.Environment.Entity(id)
  if item!=nil {items=append(items,map[string]any{"ID":id,"Position":item.Base().Position,"Name":item.Base().Name})}
 }
 data,err:=json.Marshal(map[string]any{"Home":home,"HomeID":encounter.homeID,"State":"Collecting","Items":items,"Inspected":map[int64]bool{},"HullSegments":hull,"Modules":modules})
 if err!=nil {panic(err)}
 if err=runtime.collectors.Restore(ship,data);err!=nil {panic(err)}
 encounter.shipIDs[ship.ID]=true
 encounter.events=append(encounter.events,collectorBenchmarkEvent{At:time.Now().UnixMilli(),Kind:"launch",ShipID:ship.ID})
}

// Observe actual outcomes, retaining file I/O until the benchmark disconnects.
func(s *GameSession) recordCollectorBenchmark(events []protocol.SimulationEvent) {
 encounter:=collectorBenchmarkEncounters[s.World]
 if encounter==nil||encounter.saved||encounter.sectorID!=s.currentSector {return}
 now:=time.Now().UnixMilli()
 runtime:=s.sectors[s.currentSector]
 active:=0
 unknown:=false
 runtime.collectors.ForEachShip(func(ship *objects.Ship) {
  if !encounter.existingShips[ship.ID]&&!encounter.shipIDs[ship.ID] {unknown=true}
 })
 if unknown {
  for _,saved:=range runtime.collectors.Capture() {
   if encounter.existingShips[saved.ID]||encounter.shipIDs[saved.ID] {continue}
   var state struct{HomeID int64}
   if err:=json.Unmarshal(saved.State,&state);err!=nil {panic(err)}
   if state.HomeID!=encounter.homeID {encounter.existingShips[saved.ID]=true;continue}
   encounter.shipIDs[saved.ID]=true
   encounter.events=append(encounter.events,collectorBenchmarkEvent{At:now,Kind:"launch",ShipID:saved.ID})
  }
 }
 runtime.collectors.ForEachShip(func(ship *objects.Ship) {if encounter.shipIDs[ship.ID] {active++}})
 encounter.maximumActive=max(encounter.maximumActive,active)
 for _,event:=range events {
  if pickup,ok:=event.(protocol.ItemCollected);ok&&encounter.itemIDs[pickup.ItemID] {
   owner,_:=s.World.Players.Get(pickup.By)
   kind:="external-pickup"
   if encounter.shipIDs[owner.ShipID] {kind="pickup"}
   encounter.events=append(encounter.events,collectorBenchmarkEvent{At:now,Kind:kind,ShipID:owner.ShipID,ItemID:pickup.ItemID})
  }
  if docked,ok:=event.(protocol.Docked);ok&&encounter.seed!=nil&&encounter.dockedTick==nil&&docked.DockedTo==encounter.homeID {
   owner,_:=s.World.Players.Get(docked.PlayerID)
   entity,exists:=s.World.Entities.Get(owner.ShipID)
   ship,isShip:=entity.(*objects.Ship)
   if exists&&isShip&&encounter.shipIDs[ship.ID]&&!ship.Dead&&ship.DockedTo!=nil&&*ship.DockedTo==encounter.homeID {
    tick:=s.World.Tick
    encounter.dockedTick=&tick
    encounter.events=append(encounter.events,collectorBenchmarkEvent{At:now,Kind:"dock",ShipID:ship.ID})
    if encounter.player.socket!=nil {s.sendControl(encounter.player.socket,protocol.ServerControl{Type:"chat",Sender:"NPC benchmark",Text:fmt.Sprintf("/npc-benchmark-docked %d %d",ship.ID,tick)})}
   }
  }
 }
 if encounter.player.socket!=nil {return}
 deposited:=0
 removedCargo:=[]int64{}
 visited:=map[*objects.Craft]bool{}
 changed:=map[*objects.Craft]bool{}
 stripCargo:=func(entity simulation.Entity,_ int64) {
  holder,ok:=entity.(interface{CraftBase()*objects.Craft})
  if !ok {return}
  craft:=holder.CraftBase()
  if visited[craft] {return}
  visited[craft]=true
  for _,item:=range craft.CargoContents {
   if encounter.itemIDs[item.Base().ID] {
    removedCargo=append(removedCargo,item.Base().ID)
    if entity.Base().Kind=="station" {deposited++}
   }
  }
  before:=len(craft.CargoContents)
  craft.CargoContents=slices.DeleteFunc(craft.CargoContents,func(item simulation.Entity)bool{return encounter.itemIDs[item.Base().ID]})
  if len(craft.CargoContents)!=before {
   changed[craft]=true
   if world:=entity.Base().World;world!=nil&&world.EntityChanged!=nil {world.EntityChanged(entity,false)}
  }
 }
 // A player or another NPC may take fixture cargo. Remove only the known IDs,
 // including cargo carried into another sector or held by a hidden player.
 for _,state:=range s.sectors {
  state.world.Entities.ForEach(stripCargo)
  state.regions.Sleeping.ForEach(stripCargo)
 }
 s.players.ForEach(func(player *playerRecord,_ string) {
  stripCargo(player.ship,player.shipID)
  if changed[player.ship.CraftBase()] {s.savePlayer(player)}
 })
 slices.Sort(removedCargo)
 preparation:="Initial station observation is primed once; idle defers its next check by 180 seconds. Production gameplay timing remains unchanged."
 if encounter.scenario=="collection-courser"||encounter.scenario=="collection-finch" {preparation="Explicit launch after warmup; the shared collector policy flies the chosen stock hull with its native cargo capacity. No item-age wait or altered gameplay timing."}
 report:=map[string]any{"startedAt":encounter.startedAt,"endedAt":now,"scenario":encounter.scenario,"seed":encounter.seed,"layout":encounter.layout,"dockedTick":encounter.dockedTick,"items":len(encounter.itemIDs),"maximumActive":encounter.maximumActive,"deposited":deposited,"cleanupCargoItems":removedCargo,"events":encounter.events,"agePreparation":preparation}
 data,err:=json.MarshalIndent(report,"","  ")
 if err!=nil {panic(err)}
 path:=filepath.Join(__REPORT_DIRECTORY__,fmt.Sprintf("npc-%d.json",encounter.player.shipID))
 if err=os.WriteFile(path,data,0600);err!=nil {panic(err)}
 remove:=[]int{}
 index:=0
 runtime.collectors.ForEachShip(func(ship *objects.Ship) {
  if encounter.shipIDs[ship.ID] {
   s.World.Entities.Delete(ship.ID)
   s.World.Players.Delete(*ship.PlayerID)
   delete(s.inputs,*ship.PlayerID)
   remove=append(remove,index)
  }
  index++
 })
 for index:=len(remove)-1;index>=0;index-- {
  runtime.collectors.Collectors=slices.Delete(runtime.collectors.Collectors,remove[index],remove[index]+1)
 }
 for _,state:=range s.sectors {
  for id:=range encounter.itemIDs {
   if item,ok:=state.world.Entities.Get(id);ok {item.Base().Remove()}
   if item,ok:=state.regions.Sleeping.Get(id);ok {if state.world.EntityChanged!=nil {state.world.EntityChanged(item,true)};state.regions.Sleeping.Delete(id)}
  }
 }
 var stations map[int64]json.RawMessage
 if err=json.Unmarshal(runtime.collectors.CaptureDispatch(),&stations);err!=nil {panic(err)}
 if encounter.previousStation!=nil {stations[encounter.homeID]=encounter.previousStation} else {delete(stations,encounter.homeID);delete(runtime.collectors.Stations,encounter.homeID)}
 dispatch,err:=json.Marshal(stations)
 if err!=nil {panic(err)}
 if err=runtime.collectors.RestoreDispatch(dispatch);err!=nil {panic(err)}
 // The temporary station clock is gone. Restore the matching discovery cache
 // so future ordinary items can discover that station again at the next check.
 runtime.collectors.Regions=encounter.previousRegions
 if npcBenchmarkAnchors[s.World]==encounter.player.ship {delete(npcBenchmarkAnchors,s.World)}
 encounter.saved=true
}
`;

export function prepareNPCFixture({
  directory,
  items = 6,
  manifestPath = 'benchmarking/_local/npc-fixture.json',
}: {
  directory: string;
  items?: number;
  manifestPath?: string;
}) {
  assert(
    Number.isInteger(items) && items >= 3 && items <= 48,
    'Use between 3 and 48 fixture items',
  );
  const output = resolve(directory);
  const sourcePath = resolve('src/server/network/game-session.go');
  const source = readFileSync(sourcePath, 'utf8');
  const events = '\ts.sectors[s.currentSector].pirates.ItemsCollected(events)';
  const receive =
    'func (s *GameSession) Receive(message protocol.Control, socket SessionSocket) {';
  const disconnect = 'func (s *GameSession) Disconnect(socket SessionSocket) {';
  const beginPlay = 'func (s *GameSession) play(p *playerRecord) {';
  const snapshotGate = 'if !s.World.Players.Has(p.playerID) {';
  const streamingGate =
    's.World.Players.Has(p.playerID) || s.World.Entities.Has(p.shipID)';

  assert.equal(
    source.split(events).length,
    2,
    'Expected one authoritative event boundary',
  );
  assert.equal(
    source.split(receive).length,
    2,
    'Expected one control boundary',
  );
  assert.equal(
    source.split(disconnect).length,
    2,
    'Expected one disconnect boundary',
  );
  assert.equal(source.split(beginPlay).length, 2, 'Expected one Play function');
  assert.equal(
    source.split(snapshotGate).length,
    2,
    'Expected one snapshot player gate',
  );
  assert.equal(
    source.split(streamingGate).length,
    2,
    'Expected one streaming observer gate',
  );
  const replacement = source
    .replace(beginPlay, beginPlay + '\n\tif s.playNPCBenchmark(p) {return}')
    .replace(
      streamingGate,
      streamingGate + ' || (p.socket != nil && npcBenchmarkViewer(p))',
    )
    .replace(
      snapshotGate,
      'if !s.World.Players.Has(p.playerID) && !npcBenchmarkViewer(p) {',
    )
    .replace(
      receive,
      receive +
        `
 if s.seedCollectionBenchmark(message,socket) {return}
 if message.Type=="chat" && message.Text=="/npc-benchmark-start" {
  if p:=s.playersBySocket[socket]; p!=nil {defer s.useSector(p.sectorID)();s.startCollectionBenchmark(p)}
  return
 }
`,
    )
    .replace(
      disconnect,
      disconnect +
        '\n\tdelete(collectionBenchmarkSeeds,s.playersBySocket[socket])\n\tdelete(collectionBenchmarkSlots,s.playersBySocket[socket])',
    )
    .replace(events, '\ts.recordCollectorBenchmark(events)\n' + events);

  mkdirSync(output, { recursive: true });
  const session = resolve(output, 'game-session.go');
  const helper = resolve(output, 'collector-benchmark-fixture.go');
  const overlay = resolve(output, 'overlay.json');
  const extraReplacements: Record<string, string> = {};

  for (const [filename, needle, value] of [
    [
      'replication-common.go',
      'v.snapshotList = v.world.Entities.ReadValues()',
      'v.snapshotList = npcBenchmarkEntities(v.world)',
    ],
    [
      'persistence.go',
      'func (s *GameSession) savePlayer(p *playerRecord) {',
      'func (s *GameSession) savePlayer(p *playerRecord) {\n\tif npcBenchmarkViewer(p) {return}',
    ],
    [
      'world-sounds.go',
      '!s.World.Players.Has(p.playerID) || p.socket.BufferedBytes()',
      '(!s.World.Players.Has(p.playerID) && !npcBenchmarkViewer(p)) || p.socket.BufferedBytes()',
    ],
  ]) {
    const original = resolve('src/server/network', filename);
    const contents = readFileSync(original, 'utf8');

    assert.equal(
      contents.split(needle).length,
      2,
      `Expected one fixture boundary in ${filename}`,
    );
    const generated = resolve(output, filename);

    writeFileSync(generated, contents.replace(needle, value));
    extraReplacements[original] = generated;
  }

  writeFileSync(session, replacement);
  writeFileSync(
    helper,
    fixture
      .replace('__REPORT_DIRECTORY__', JSON.stringify(output))
      .replace('__ITEM_COUNT__', String(items)),
  );

  writeFileSync(
    overlay,
    JSON.stringify(
      {
        Replace: {
          ...extraReplacements,
          [sourcePath]: session,
          [resolve('src/server/network/collector-benchmark-fixture.go')]:
            helper,
        },
      },
      null,
      2,
    ) + '\n',
  );

  mkdirSync(dirname(resolve(manifestPath)), { recursive: true });
  writeFileSync(
    resolve(manifestPath),
    JSON.stringify({ directory: output, items }, null, 2),
  );
  return overlay;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const overlay = prepareNPCFixture({
    directory: process.argv[2] || '/tmp/unicorn-npc-benchmark',
    items: Number(process.argv[3] || 6),
  });

  console.log(overlay);
  console.log(
    'Stop the existing Go watcher first; only one server can own the world database.',
  );
  console.log(
    `Start GOMEMLIMIT=300MiB GOFLAGS=-overlay=${overlay} npm run dev:server and wait for port 3001 to be ready. Then run npm run benchmark:npc -- --watch --scenario all.`,
  );
}
