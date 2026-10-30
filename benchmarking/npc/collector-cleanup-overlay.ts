// Passive local telemetry: no fabricated objects or changes to gameplay state.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const helper = String.raw`package network

import (
 "encoding/json"
 "os"
 "slices"
 "syscall"
 "time"
 "github.com/burntcustard/unicorn-mining-co/src/server/objects"
 "github.com/burntcustard/unicorn-mining-co/src/server/npc/collector"
 "github.com/burntcustard/unicorn-mining-co/src/server/protocol"
 "github.com/burntcustard/unicorn-mining-co/src/server/simulation"
 Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type collectorCleanupTelemetryState struct {
 lastTick uint64
 lastConnected int
 started bool
 events []map[string]any
 knownCollectors map[int64]bool
}

var collectorCleanupTelemetryStates = map[*simulation.World]*collectorCleanupTelemetryState{}
var collectorCleanupTelemetryFile *os.File

func(s *GameSession) beginCollectorCleanup() {
 if os.Getenv("COLLECTOR_CLEANUP_TELEMETRY")!=""&&collectorCleanupTelemetryStates[s.World]==nil {s.recordCollectorCleanup(nil)}
}

func collectorCleanupCargo(cargo []simulation.Entity) []int64 {
 ids:=make([]int64,0,len(cargo))
 for _,item:=range cargo {ids=append(ids,item.Base().ID)}
 slices.Sort(ids)
 return ids
}

// Samples all eligible loose items every five simulated seconds, with exact
// pickup/launch ticks buffered between samples. Connection transitions sample
// immediately so miners' disconnect defines an observable, fixed cohort.
func(s *GameSession) recordCollectorCleanup(events []protocol.SimulationEvent) {
 path:=os.Getenv("COLLECTOR_CLEANUP_TELEMETRY")
 if path=="" {return}
 world:=s.World
 runtime:=s.sectors[s.currentSector]
 state:=collectorCleanupTelemetryStates[world]
 if state==nil {state=&collectorCleanupTelemetryState{knownCollectors:map[int64]bool{}};collectorCleanupTelemetryStates[world]=state}
 now:=time.Now().UnixMilli()
 collectors:=map[int64]bool{}
 pirates:=map[int64]bool{}
 runtime.collectors.ForEachShip(func(ship *objects.Ship) {
  collectors[ship.ID]=true
  if !state.knownCollectors[ship.ID] {
   state.knownCollectors[ship.ID]=true
   state.events=append(state.events,map[string]any{"kind":"collector-observed","shipID":ship.ID,"tick":world.Tick,"at":now,"initial":!state.started})
  }
 })
 runtime.pirates.ForEachShip(func(ship *objects.Ship) {pirates[ship.ID]=true})
 for _,event:=range events {
  if pickup,ok:=event.(protocol.ItemCollected);ok {
   owner,_:=world.Players.Get(pickup.By)
   actor:="unknown"
   if collectors[owner.ShipID] {actor="collector"} else if pirates[owner.ShipID] {actor="pirate"} else if owner.ShipID!=0 {actor="player"}
   state.events=append(state.events,map[string]any{"kind":"pickup","itemID":pickup.ItemID,"shipID":owner.ShipID,"actor":actor,"tick":world.Tick,"at":now})
  }
 }
 connected:=0
 s.sectorPlayers(func(p *playerRecord,_ string){if p.socket!=nil {connected++}})
 interval:=max(uint64(1),uint64(5/world.Specification.Simulation.SimulationStep))
 if state.started&&world.Tick-state.lastTick<interval&&connected==state.lastConnected {return}
 items:=[]map[string]any{}
 cargo:=[]map[string]any{}
 visit:=func(sleeping bool)func(simulation.Entity,int64) {
  return func(entity simulation.Entity,id int64) {
   object:=entity.Base()
   if collector.Eligible(entity) {
    nearest:=0.
    var nearestID int64
    for homeID,station:=range runtime.collectors.Stations {
     distance:=Vec.Distance(object.Position,station.Home.Position)
     if nearestID==0||distance<nearest {nearest,nearestID=distance,homeID}
    }
    items=append(items,map[string]any{"id":id,"position":object.Position,"velocity":object.Velocity,"name":object.Name,"definitionID":object.DefinitionID,"sleeping":sleeping,"nearestStationID":nearestID,"stationDistance":nearest,"inOperatingRange":nearestID!=0&&nearest<=world.Specification.CollectorSpec.OperatingRadius})
   }
   if station,ok:=entity.(*objects.Station);ok&&len(station.CargoContents)>0 {
    cargo=append(cargo,map[string]any{"id":id,"kind":"station","items":collectorCleanupCargo(station.CargoContents)})
   }
  }
 }
 world.Entities.ForEach(visit(false))
 s.regions.Sleeping.ForEach(visit(true))
 npcs:=[]map[string]any{}
 for _,saved:=range runtime.collectors.Capture() {
  entity,ok:=world.Entities.Get(saved.ID)
  if !ok {continue}
  ship:=entity.(*objects.Ship)
  var npc map[string]json.RawMessage
  if err:=json.Unmarshal(saved.State,&npc);err!=nil {panic(err)}
  npcs=append(npcs,map[string]any{"id":ship.ID,"position":ship.Position,"velocity":ship.Velocity,"rotation":ship.Rotation,"fuel":ship.Fuel,"state":npc["State"],"targetID":npc["TargetID"],"items":npc["Items"],"cargo":collectorCleanupCargo(ship.CargoContents),"inspect":npc["Inspect"],"attemptStartedAt":npc["AttemptStartedAt"],"homeID":npc["HomeID"],"dead":ship.Dead,"dockedTo":ship.DockedTo})
 }
 pirateStates:=[]map[string]any{}
 runtime.pirates.ForEachShip(func(ship *objects.Ship) {
  pirateStates=append(pirateStates,map[string]any{"id":ship.ID,"state":ship.NPCState,"position":ship.Position,"cargo":collectorCleanupCargo(ship.CargoContents)})
 })
 players:=[]map[string]any{}
 s.sectorPlayers(func(p *playerRecord,_ string){players=append(players,map[string]any{"id":p.shipID,"connected":p.socket!=nil,"hidden":p.hiddenShip,"cargo":collectorCleanupCargo(p.ship.CargoContents)})})
 stations:=[]map[string]any{}
 for id,station:=range runtime.collectors.Stations {
  seen:=make([]int64,0,len(station.Seen))
  for id:=range station.Seen {seen=append(seen,id)}
  slices.Sort(seen)
  stations=append(stations,map[string]any{"id":id,"position":station.Home.Position,"checkAt":station.CheckAt,"launchAt":station.LaunchAt,"seen":seen,"queue":station.Queue})
 }
 var usage syscall.Rusage
 if err:=syscall.Getrusage(syscall.RUSAGE_SELF,&usage);err!=nil {panic(err)}
 sample:=map[string]any{"at":now,"pid":os.Getpid(),"sectorID":s.currentSector,"tick":world.Tick,"simulationStep":world.Specification.Simulation.SimulationStep,"connected":connected,"items":items,"collectors":npcs,"pirates":pirateStates,"players":players,"stations":stations,"cargo":cargo,"events":state.events,"cpu":map[string]int64{"userMicros":usage.Utime.Nano()/1000,"systemMicros":usage.Stime.Nano()/1000}}
 data,err:=json.Marshal(sample)
 if err!=nil {panic(err)}
 if collectorCleanupTelemetryFile==nil {
  collectorCleanupTelemetryFile,err=os.OpenFile(path,os.O_CREATE|os.O_WRONLY|os.O_APPEND,0600)
  if err!=nil {panic(err)}
 }
 if _,err=collectorCleanupTelemetryFile.Write(append(data,'\n'));err!=nil {panic(err)}
 state.events=nil
 state.started=true
 state.lastTick=world.Tick
 state.lastConnected=connected
}
`;

const checkRandom = String.raw`package collector

// Optional checkpoint repeatability control. SplitMix64 preserves interval
// bounds while making the sampled fraction stable for a given tick and seed.
func collectorCleanupCheckRandom(s *Manager) float64 {
 value:=uint64(s.World.Tick)^uint64(s.Environment.(interface{WorldSeed() float64}).WorldSeed())
 value+=0x9e3779b97f4a7c15
 value=(value^(value>>30))*0xbf58476d1ce4e5b9
 value=(value^(value>>27))*0x94d049bb133111eb
 value^=value>>31
 return float64(value>>11)/9007199254740992.
}

`;

export function prepareCollectorCleanupOverlay({
  directory,
  deterministicChecks = false,
  baseOverlay,
}: {
  directory: string;
  deterministicChecks?: boolean;
  baseOverlay?: string;
}) {
  const output = resolve(directory);
  const sourcePath = resolve('src/server/network/game-session.go');

  const inherited = baseOverlay
    ? (JSON.parse(readFileSync(baseOverlay, 'utf8')) as {
        Replace: Record<string, string>;
      })
    : { Replace: {} };

  const source = readFileSync(
    inherited.Replace[sourcePath] || sourcePath,
    'utf8',
  )
    .replace('\ts.beginCollectorCleanup()\n', '')
    .replace('\ts.recordCollectorCleanup(events)\n', '');
  const boundary =
    '\ts.sectors[s.currentSector].pirates.ItemsCollected(events)';
  const beginning = '\tworld := s.World\n\t// Match the launch transition';

  assert.equal(
    source.split(boundary).length,
    2,
    'Expected one simulation event boundary',
  );
  assert.equal(
    source.split(beginning).length,
    2,
    'Expected one sector tick start',
  );
  mkdirSync(output, { recursive: true });
  const session = resolve(output, 'game-session.go');
  const telemetry = resolve(output, 'collector-cleanup-telemetry.go');
  const overlay = resolve(output, 'overlay.json');

  const replacements = {
    ...inherited.Replace,
    [sourcePath]: session,
    [resolve('src/server/network/collector-cleanup-telemetry.go')]: telemetry,
  };

  writeFileSync(
    session,
    source
      .replace(
        beginning,
        '\tworld := s.World\n\ts.beginCollectorCleanup()\n\t// Match the launch transition',
      )
      .replace(boundary, '\ts.recordCollectorCleanup(events)\n' + boundary),
  );
  writeFileSync(telemetry, helper);

  if (deterministicChecks) {
    const dispatchPath = resolve('src/server/npc/collector/dispatch.go');
    const dispatch = readFileSync(
      inherited.Replace[dispatchPath] || dispatchPath,
      'utf8',
    );
    const replacement = resolve(output, 'dispatch.go');

    assert(
      dispatch.split('rand.Float64()').length === 2 ||
        dispatch.split('collectorCleanupCheckRandom(s)').length === 2,
      'Expected one station interval sampler',
    );
    writeFileSync(
      replacement,
      dispatch
        .replace('\t"math/rand/v2"\n', '')
        .replace('rand.Float64()', 'collectorCleanupCheckRandom(s)'),
    );
    replacements[dispatchPath] = replacement;
    const sampler = resolve(output, 'collector-cleanup-random.go');

    writeFileSync(sampler, checkRandom);
    replacements[resolve('src/server/npc/collector/cleanup-random.go')] =
      sampler;
  }

  writeFileSync(
    overlay,
    JSON.stringify(
      {
        Replace: replacements,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        baseOverlay: baseOverlay ? resolve(baseOverlay) : null,
        deterministicChecks,
        samplingSeconds: 5,
        checkRandom: deterministicChecks
          ? 'SplitMix64 of simulation tick XOR world seed; configured interval bounds unchanged'
          : 'Production math/rand/v2',
        telemetryPassive: true,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    resolve(output, 'source-hashes.json'),
    JSON.stringify(
      {
        files: Object.fromEntries(
          Object.entries(replacements).map(([source, replacement]) => [
            source,
            replacement
              ? createHash('sha256')
                  .update(readFileSync(replacement))
                  .digest('hex')
              : 'excluded-new-file',
          ]),
        ),
      },
      null,
      2,
    ) + '\n',
  );

  return overlay;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    prepareCollectorCleanupOverlay({
      directory: process.argv[2] || '/tmp/unicorn-collector-cleanup',
      deterministicChecks: process.argv.includes('--deterministic-checks'),
      baseOverlay: process.argv.includes('--base-overlay')
        ? process.argv[process.argv.indexOf('--base-overlay') + 1]
        : undefined,
    }),
  );
}
