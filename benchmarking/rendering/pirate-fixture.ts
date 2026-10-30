// Prepare compiler-only local NPC provisioning; no production source is edited.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fixture = String.raw`package network

import (
 "encoding/json"
 "fmt"
 "math"
 "os"
 "path/filepath"
 "slices"
 "time"
 "github.com/burntcustard/unicorn-mining-co/src/server/objects"
 "github.com/burntcustard/unicorn-mining-co/src/server/protocol"
 "github.com/burntcustard/unicorn-mining-co/src/server/simulation"
 Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type renderingHit struct {
 At int64
 By int64
 TargetID int64
 Damage float64
 Weapon string
}

type renderingEncounter struct {
 player *playerRecord
 ships []*objects.Ship
 starts []Vec.Vector
 movement []float64
 hits []renderingHit
 startedAt int64
 saved bool
}

var renderingEncounters = map[*GameSession]*renderingEncounter{}

// Provision three different combatants once. The finite ammo items and all
// subsequent movement, collisions, shots and damage use ordinary game rules.
func (s *GameSession) preparePirateRendering(p *playerRecord) {
 if p.profile.DisplayName != "Render pirate" { return }
 catalog := s.World.Specification
 sector := s.sectorMap.Sectors[slices.IndexFunc(s.sectorMap.Sectors,func(sector simulation.Sector)bool{return sector.ID==s.currentSector})]
 generator := simulation.NewRegionGenerator(catalog,sector)
 fields := generator.GenerateFields(uint32(s.worldSeed),Vec.Create(-40000,-40000),Vec.Create(40000,40000))
 slices.SortFunc(fields,func(a,b protocol.FieldDescription)int{return int(Vec.LengthSquared(a.Position)-Vec.LengthSquared(b.Position))})
 field := slices.IndexFunc(fields,func(field protocol.FieldDescription)bool{return field.Resource==2})
 if field<0 { panic("missing generated combat field") }
 center := fields[field].Position
 ranges := protocol.Ranges(catalog.Simulation.ServerRegionRanges)
 view := s.regions.View(center,&ranges)
 offsets := []Vec.Vector{Vec.Create(0,0),Vec.Create(-320,-160),Vec.Create(-200,-400)}
 clear := func(position Vec.Vector)bool{
  for _,rock := range view.Asteroids {
   if Vec.Distance(position,rock.Position)<max(rock.Radius,rock.RadiusEven)+90 { return false }
  }
  return true
 }
 chosen,found := center,false
 for distance:=0.;distance<=2400&&!found;distance+=120 {
  for angle:=0.;angle<2*math.Pi;angle+=math.Pi/12 {
   candidate:=Vec.Add(center,Vec.Create(distance*math.Cos(angle),distance*math.Sin(angle)))
   if slices.ContainsFunc(offsets,func(offset Vec.Vector)bool{return !clear(Vec.Add(candidate,offset))}) { continue }
   chosen,found=candidate,true
   break
  }
 }
 if !found { panic("missing three clear combat starting positions") }
 // Remove only this fixture's disconnected previous encounter.
 if old:=renderingEncounters[s];old!=nil&&old.player.socket==nil {
  for _,ship:=range old.ships {s.World.Entities.Delete(ship.ID);s.World.Players.Delete(*ship.PlayerID)}
  s.sectors[s.currentSector].pirates.RemoveRendering(old.player)
 }
 s.World.Entities.Delete(p.ship.ID)
 p.ship=objects.CreatePlayerShip(s.World,objects.Properties{DefinitionID:"courser",Shades:catalog.Colors["cyan"],ObjectProperties:simulation.ObjectProperties{World:s.World,ID:&p.shipID,PlayerID:&p.playerID,Position:chosen,Name:new("Render pirate")}})
 simulation.AddEntity(s.World,p.ship)
 p.lastInput=protocol.Input{AutogunActive:true}
 ammoID:=simulation.EntityID(s.World)
 p.ship.CargoContents=append(p.ship.CargoContents,objects.NewItem("autogunAmmo",simulation.ObjectProperties{World:s.World,ID:&ammoID},catalog))
 s.regions.Sync(s.World,s.positions())
 home:=s.nearestStation(chosen)
 ships:=s.sectors[s.currentSector].pirates.PrepareRendering(p,home,chosen,offsets)
 encounter:=&renderingEncounter{player:p,ships:ships,movement:make([]float64,len(ships)),startedAt:time.Now().UnixMilli()}
 for _,ship:=range ships {
  // Durable, finite targets keep the same encounter active for a full capture;
  // unlike enormous health, this still exposes ordinary damage in float32.
  for _,segment:=range ship.Segments {if health:=segment.TargetHealth();health!=nil&&*health>0&&!math.IsNaN(*health){*health=5000};if segment.Mount!=nil&&segment.Mount.HealthActivated!=nil{*segment.Mount.HealthActivated=5000}}
  encounter.starts=append(encounter.starts,ship.Position)
 }
 renderingEncounters[s]=encounter
 s.regions.Sync(s.World,s.positions())
}

func(s *GameSession) keepPirateRenderingReady(){
 encounter:=renderingEncounters[s]
 if encounter==nil||encounter.player.socket==nil{return}
 for _,ship:=range encounter.ships {ship.Fuel=ship.FuelCapacity}
}

// Retain real authoritative weapon hits. Write once after the owned browser
// disconnects, so artifact I/O never interrupts the measured frame window.
func(s *GameSession) recordRenderingCombat(events []protocol.SimulationEvent){
 e:=renderingEncounters[s]
 if e==nil||e.saved{return}
 at:=time.Now().UnixMilli()
 for i,ship:=range e.ships {e.movement[i]=max(e.movement[i],Vec.Distance(ship.Position,e.starts[i]))}
 for _,event:=range events {
  hit:=renderingHit{At:at}
  switch event:=event.(type){
   case protocol.CollisionEvent:hit.By,hit.TargetID,hit.Damage,hit.Weapon=event.By,event.B,event.Damage[1],"kinetic"
   case protocol.LaserDamage:hit.By,hit.TargetID,hit.Damage,hit.Weapon=event.By,event.TargetID,event.Damage,"laser"
   default:continue
  }
  if hit.By!=0&&hit.Damage>0&&slices.ContainsFunc(e.ships,func(ship *objects.Ship)bool{return ship.ID==hit.TargetID}) {e.hits=append(e.hits,hit)}
 }
 if e.player.socket!=nil{return}
 bodies:=[]map[string]any{}
 for i,ship:=range e.ships {
  rounds:=0
  for _,item:=range ship.CargoContents{if ammo,ok:=item.(*objects.Item);ok&&ammo.Rounds!=nil{rounds+=*ammo.Rounds}}
  weapons:=[]string{}
  for _,module:=range ship.Modules(){if spec:=module.ModuleBase();spec.Spec.Behavior=="weapon"||spec.Spec.Behavior=="beam"{weapons=append(weapons,spec.Type)}}
  bodies=append(bodies,map[string]any{"weapons":weapons,"id":ship.ID,"playerId":*ship.PlayerID,"definitionId":ship.DefinitionID,"movement":e.movement[i],"roundsRemaining":rounds})
 }
 report:=map[string]any{"startedAt":e.startedAt,"endedAt":at,"playerShipId":e.player.shipID,"ships":bodies,"hits":e.hits}
 data,err:=json.MarshalIndent(report,"","  ")
 if err!=nil{panic(err)}
 path:=filepath.Join(__REPORT_DIRECTORY__,fmt.Sprintf("combat-%d.json",e.player.shipID))
 if err=os.WriteFile(path,data,0600);err!=nil{panic(err)}
 e.saved=true
}
`;

const roleFixture = String.raw`package pirate

import (
 "math"
 "slices"
 ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
 "github.com/burntcustard/unicorn-mining-co/src/server/objects"
 "github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
 "github.com/burntcustard/unicorn-mining-co/src/server/protocol"
 "github.com/burntcustard/unicorn-mining-co/src/server/simulation"
 Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func(m *Manager) RemoveRendering(victim ai.Player) {
 m.Pirates=slices.DeleteFunc(m.Pirates,func(npc *pirate)bool{return npc.victim.AccountID()==victim.AccountID()})
}

func(m *Manager) PrepareRendering(victim ai.Player,home protocol.StationDescription,chosen Vec.Vector,offsets []Vec.Vector) []*objects.Ship {
 catalog:=m.World.Specification
 ships:=[]*objects.Ship{victim.Ship()}
 pirates:=[]*pirate{}
 for i,definition:=range []string{"mustang","arrow"} {
  npc:=m.spawn(victim,home)
  id,owner:=npc.ship.ID,*npc.ship.PlayerID
  m.World.Entities.Delete(id)
  npc.ship=objects.CreatePlayerShip(m.World,objects.Properties{DefinitionID:definition,Shades:catalog.Colors[[]string{"orange","violet"}[i]],ObjectProperties:simulation.ObjectProperties{World:m.World,ID:&id,PlayerID:&owner,Position:Vec.Add(chosen,offsets[i+1]),Name:new("Pirate "+definition)}})
  npc.ship.Hostile,npc.ship.NPCState=true,stateNames[fighting]
  weapon:="autogun"
  if i==1 {weapon="laser"} else {npc.ship.CargoContents=append(npc.ship.CargoContents,npc.ammunition)}
  moduleID:=simulation.EntityID(m.World)
  weaponModule:=modules.Create(weapon,simulation.ObjectProperties{World:m.World,ID:&moduleID},catalog)
  var mount *simulation.Mount
  for _,candidate:=range npc.ship.Mounts(){if candidate.Module==nil&&slices.Contains(candidate.Fits,weapon){mount=candidate;break}}
  if mount==nil {for _,candidate:=range npc.ship.Mounts(){if slices.Contains(candidate.Fits,weapon)&&candidate.Module!=nil&&candidate.Module.ModuleBase().Spec.Behavior=="cargoHatch"{mount=candidate;break}}}
  npc.ship.Fit(weaponModule,mount)
  if weaponModule.ModuleBase().Mount==nil {panic("combat ship has no compatible weapon mount")}
  npc.State=fighting
  npc.aggressors[victim.ObserverID()]=true
  npc.ship.Face(math.Atan2(chosen.Y-npc.ship.Position.Y,chosen.X-npc.ship.Position.X))
  simulation.AddEntity(m.World,npc.ship)
  pirates=append(pirates,npc)
  ships=append(ships,npc.ship)
 }
 for _,npc:=range pirates {for _,other:=range ships {if other!=npc.ship {npc.aggressors[*other.PlayerID]=true}};if enemy:=ai.NearestEnemy(npc.ship,npc.aggressors);enemy!=nil{npc.ship.Face(math.Atan2(enemy.Position.Y-npc.ship.Position.Y,enemy.Position.X-npc.ship.Position.X))}}
 return ships
}

// The fixture uses the real Go Pilot for obstacle navigation and passing runs,
// with the mounted weapon's speed (or instantaneous beam) for its firing aim.
func(m *Manager) renderingInput(npc *pirate)protocol.Input {
 input:=protocol.Input{AutogunActive:true,LaserActive:true,CargoHatch:true}
 enemy:=ai.NearestEnemy(npc.ship,npc.aggressors)
 if enemy==nil {return input}
 ship:=npc.ship
 offset:=Vec.Subtract(enemy.Position,ship.Position)
 distance:=Vec.Length(offset)
 flight:=0.
 for _,module:=range ship.Modules(){spec:=module.ModuleBase().Spec;if spec.Projectile.Speed>0{flight=min(1,distance/spec.Projectile.Speed);break}}
 aim:=Vec.AddScaled(enemy.Position,Vec.Subtract(enemy.Velocity,ship.Velocity),flight)
 input.Thrust,input.Turn=npc.pilot.Steer(ship,ai.Movement{Position:aim,Velocity:enemy.Velocity,PassDistance:m.World.Specification.PirateSpec.PassDistance,TargetID:enemy.ID})
 angle:=math.Remainder(math.Atan2(aim.Y-ship.Position.Y,aim.X-ship.Position.X)-ship.Rotation,2*math.Pi)
 input.Fire=math.Abs(angle)<m.World.Specification.PirateSpec.AimTolerance&&distance<700
 return input
}

`;

export function preparePirateRenderingFixture({
  directory,
}: {
  directory: string;
}) {
  const output = resolve(directory);
  const sourcePath = resolve('src/server/network/game-session.go');
  const source = readFileSync(sourcePath, 'utf8');
  const play =
    '\tp.playedAt = s.now()\n\ts.regions.Sync(s.World, s.positions())\n\ts.sendSnapshot(p, nil, nil)';
  const update = '\ts.sectors[s.currentSector].pirates.Update()';
  const events = '\ts.sectors[s.currentSector].pirates.ItemsCollected(events)';

  assert.equal(
    source.split(play).length,
    2,
    'Expected one normal Play boundary',
  );
  assert.equal(
    source.split(update).length,
    2,
    'Expected one authoritative NPC update',
  );
  assert.equal(
    source.split(events).length,
    2,
    'Expected one authoritative event boundary',
  );
  const replacement = source
    .replace(
      play,
      '\tp.playedAt = s.now()\n\ts.preparePirateRendering(p)\n\ts.regions.Sync(s.World, s.positions())\n\ts.sendSnapshot(p, nil, nil)',
    )
    .replace(update, '\ts.keepPirateRenderingReady()\n' + update)
    .replace(events, '\ts.recordRenderingCombat(events)\n' + events);

  mkdirSync(output, { recursive: true });
  const gameSession = resolve(output, 'game-session.go');
  const helper = resolve(output, 'pirate-rendering-fixture.go');
  const roleHelper = resolve(output, 'rendering-role-fixture.go');
  const overlay = resolve(output, 'overlay.json');

  writeFileSync(gameSession, replacement);
  writeFileSync(roleHelper, roleFixture);
  writeFileSync(
    helper,
    fixture.replace('__REPORT_DIRECTORY__', JSON.stringify(output)),
  );
  mkdirSync(resolve('benchmarking/_local'), { recursive: true });
  writeFileSync(
    resolve('benchmarking/_local/rendering-pirate-fixture.json'),
    JSON.stringify({ directory: output }, null, 2),
  );

  const behaviorPath = resolve('src/server/npc/pirate/behavior.go');
  const behavior = readFileSync(behaviorPath, 'utf8');
  const combat = behavior.replace(
    'cannon = cannon || module.Type == "cannonSm"',
    'cannon = cannon || module.Type == "cannonSm" || npc.victim.Ship().Name == "Render pirate" && (module.Spec.Behavior == "weapon" || module.Spec.Behavior == "beam")',
  );
  const movement = combat.replace(
    'func (m *Manager) inputFor(npc *pirate) protocol.Input {',
    'func (m *Manager) inputFor(npc *pirate) protocol.Input {\n if npc.victim.Ship().Name == "Render pirate" { return m.renderingInput(npc) }',
  );

  assert.notEqual(combat, behavior);
  assert.notEqual(movement, combat);
  writeFileSync(resolve(output, 'pirate-behavior.go'), movement);

  writeFileSync(
    overlay,
    JSON.stringify(
      {
        Replace: {
          [sourcePath]: gameSession,
          [behaviorPath]: resolve(output, 'pirate-behavior.go'),
          [resolve('src/server/network/pirate-rendering-fixture.go')]: helper,
          [resolve('src/server/npc/pirate/rendering-fixture.go')]: roleHelper,
        },
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
  const directory = process.argv[2] || '/tmp/unicorn-pirate-rendering';
  const overlay = preparePirateRenderingFixture({ directory });

  console.log(overlay);
  console.log(
    `Use the normal development server with GOFLAGS=-overlay=${overlay}; then run npm run benchmark -- --scenario pirate`,
  );
}
