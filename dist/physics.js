export const runway = {halfLength: 650, halfWidth: 23, level: 8};
export const ride = .39;
const extendedRide = .96;
export const rideHeight = f => ride + (extendedRide-ride)*(f.gear??0);
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const approach = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));
const rad = Math.PI / 180;
const startZ = 545;
const rollDuration = 1.55;
const rollTravelSeconds = .72;
export function initialFlight() {
  return {x: 0, y: runway.level + extendedRide, z: startZ, heading: 0, pitch: 0, bank: 0, speed: 0,
    throttle: 0, vertical: 0, phase: 'ground', hasFlown: false, landing: null, gear: 1, departure: true};
}
export const onRunway = (x,z,surface=runway) => Math.abs(x-(surface.x??0))<surface.halfWidth
  && Math.abs(z-(surface.z??0))<surface.halfLength;
export function startManeuver(flight,action,groundAt) {
  if(flight.phase!=='air'||flight.maneuver)return false;
  const clearance=flight.y-groundAt(flight.x,flight.z)-rideHeight(flight);
  if(clearance<(action==='loop'?18:8)||(action==='loop'&&flight.speed<48))return false;
  flight.maneuver={action,time:0,angle:0,x:flight.x,y:flight.y,z:flight.z,
    pitch:flight.pitch,bank:flight.bank,speed:flight.speed};
  return true;
}

function advanceManeuver(flight,dt,groundAt) {
  const maneuver=flight.maneuver;
  let complete;
  if(maneuver.action==='loop'){
    const radius=maneuver.speed*.68;
    const energy=(1-Math.cos(maneuver.angle))*.5;
    flight.speed=maneuver.speed*(1-.21*energy);
    maneuver.angle=Math.min(2*Math.PI,maneuver.angle+flight.speed*dt/radius);
    const angle=maneuver.angle, forward=radius*Math.sin(angle);
    const level=1-smooth(0,.85,angle);
    flight.x=maneuver.x+Math.sin(flight.heading)*forward;
    flight.z=maneuver.z-Math.cos(flight.heading)*forward;
    flight.y=maneuver.y+radius*(1-Math.cos(angle));
    flight.pitch=angle+maneuver.pitch*level;
    flight.bank=maneuver.bank*level;
    flight.vertical=flight.speed*Math.sin(angle);
    complete=angle>=2*Math.PI;
  }else{
    const previous=smooth(0,rollDuration,maneuver.time);
    maneuver.time=Math.min(rollDuration,maneuver.time+dt);
    const progress=smooth(0,rollDuration,maneuver.time);
    const side=maneuver.action==='left'?-1:1;
    maneuver.angle=progress*2*Math.PI;
    flight.bank=maneuver.bank*(1-progress)+side*maneuver.angle;
    flight.pitch=maneuver.pitch*(1-progress);
    flight.vertical=approach(flight.vertical,0,4,dt);
    const forward=flight.speed*Math.cos(flight.pitch)*dt;
    // Move to a parallel flight line as the jet rolls.
    const lateral=side*maneuver.speed*rollTravelSeconds*(progress-previous);
    const sinHeading=Math.sin(flight.heading),cosHeading=Math.cos(flight.heading);
    flight.x+=sinHeading*forward+cosHeading*lateral;
    flight.z+=sinHeading*lateral-cosHeading*forward;
    flight.y+=flight.vertical*dt;
    complete=maneuver.time>=rollDuration;
  }
  const floor=groundAt(flight.x,flight.z)+rideHeight(flight);
  if(flight.y<=floor){
    flight.y=floor;
    flight.phase='crashed';
    flight.maneuver=null;
  }else if(complete){
    flight.bank=0;
    flight.pitch=0;
    flight.maneuver=null;
  }
}

export function advance(flight, input, dt, groundAt, surface=runway) {
  if (flight.phase === 'crashed' || flight.phase === 'complete') return;
  const clearance=flight.y-groundAt(flight.x,flight.z)-rideHeight(flight);
  if(flight.departure&&clearance>16)flight.departure=false;
  const deck=surface.carrier;
  const relativeX=flight.x-(surface.x??0),relativeZ=flight.z-(surface.z??0);
  const approachRunway=clearance<58&&Math.abs(relativeX)<(deck?76:95)&&Math.abs(relativeZ)<surface.halfLength+850
    &&(!deck||Math.cos(flight.heading)>.9)
    &&Math.abs(Math.sin(flight.heading))<.34&&Math.abs(flight.bank)<.5&&flight.vertical<1&&flight.speed<82;
  const gearDown=!input.combat&&(flight.phase!=='air'||flight.departure||(!flight.maneuver&&approachRunway));
  flight.gear=clamp(flight.gear+(gearDown?1:-1)*dt/1.15,0,1);
  if(flight.maneuver){
    advanceManeuver(flight,dt,groundAt);
    return;
  }
  const {pitch, roll, braking, combat=false} = input;
  const airborne = flight.phase === 'air';
  const landing = flight.phase === 'landing';
  // Wings level smoothly after release while the new heading is held.
  const turnBank = roll > 0 ? Math.max(0, flight.bank) : roll < 0 ? Math.min(0, flight.bank) : 0;
  const headingRate = airborne
    ? Math.tan(turnBank) * 9.81 / Math.max(24, flight.speed) * 1.55
    : roll * Math.min(flight.speed / 26, 1) * .55;
  flight.heading += headingRate * dt;
  flight.bank = approach(flight.bank, airborne ? roll * (combat?66:49) * rad : 0, 2.4, dt);
  const targetPitch = airborne ? pitch * (combat?(pitch>=0?29:24):(pitch>=0?19:16)) * rad : Math.max(0, pitch) * Math.min(1, Math.max(0, (flight.speed - 27) / 12)) * 11 * rad;
  flight.pitch = approach(flight.pitch, landing ? 0 : targetPitch, 2.2, dt);
  const drag = airborne
    ? (combat?.00072:.00105)*flight.speed**2 + (combat?2.2*(1-Math.cos(flight.bank))+.5*Math.abs(pitch):0)
    : .68 + .0007 * flight.speed ** 2;
  const catapult=deck&&!airborne&&!landing&&!braking&&flight.throttle>=.8&&Math.abs(relativeX)<3
    &&Math.cos(flight.heading)>.995&&relativeZ>15&&flight.speed<45?12:0;
  const arrest=deck&&landing;
  const thrust=arrest?0:(combat?10.8:8.6)*flight.throttle+catapult;
  const brakeForce=arrest?28:!airborne&&braking?7:0;
  const acceleration=thrust-drag-(airborne?9.81*Math.sin(flight.pitch):0)-brakeForce;
  flight.speed = clamp(flight.speed + acceleration * dt, 0, 119);
  const ground = groundAt(flight.x, flight.z);
  if (!airborne && flight.phase === 'ground' && flight.speed > 36 && flight.pitch > .052) {
    flight.phase = 'air';
    flight.hasFlown = true;
    flight.vertical = 1.3;
  }
  const horizontal = flight.speed * Math.cos(flight.pitch);
  flight.x += Math.sin(flight.heading) * horizontal * dt;
  flight.z -= Math.cos(flight.heading) * horizontal * dt;
  const nextGround = groundAt(flight.x, flight.z);
  if (flight.phase === 'air') {
    const lift = Math.min(1, flight.speed / (combat?58:38)) * Math.max(.42, Math.cos(flight.bank));
    const sink = Math.max(0, ((combat?55:38) - flight.speed) * .46) + (1 - lift) * (combat?5.2:2.4) + (1 - flight.throttle) * 1.65;
    flight.vertical = approach(flight.vertical, Math.sin(flight.pitch) * flight.speed - sink, 1.8, dt);
    flight.y += flight.vertical * dt;
    if (flight.y - rideHeight(flight) <= nextGround) {
      const onLandingDeck=!deck||(Math.cos(flight.heading)>.95&&flight.gear>.8&&relativeZ>-16
        &&(ground>=surface.level||flight.y-rideHeight(flight)>=surface.level-.5));
      const safe=onLandingDeck&&onRunway(flight.x,flight.z,surface)&&Math.abs(Math.sin(flight.heading))<.26
        && Math.abs(flight.bank)<.27&&flight.vertical>-6&&flight.pitch>-.12&&flight.speed<80;
      flight.phase = safe ? 'landing' : 'crashed';
      flight.y = nextGround + rideHeight(flight);
      if(safe){
        flight.landing={sink:-flight.vertical,speed:flight.speed};
        if(deck)flight.throttle=0;
      }
    }
    return;
  }
  flight.y = nextGround + rideHeight(flight);
  if((deck&&nextGround<surface.level)||(flight.speed>7&&(Math.abs(nextGround-ground)>1
    ||nextGround<1.5||(flight.speed>28&&!onRunway(flight.x,flight.z,surface))))){
    flight.phase = 'crashed';
  } else if (flight.phase === 'landing' && flight.speed < 1.2) {
    flight.phase = 'complete';
  }
}

// A preprogrammed circuit keeps the demonstration repeatable, independently of input or frame rate.
export const demoDuration = 113;
function smooth(a,b,t){const u=clamp((t-a)/(b-a),0,1);return u*u*(3-2*u);}
function route(distance) {
  const radius=520, top=-1410, bottom=1440, first=startZ-top, arc=Math.PI*radius, straight=bottom-top;
  if(distance<first) return [0,startZ-distance,0,0];
  distance-=first;
  if(distance<arc){const a=distance/radius;return [radius*(1-Math.cos(a)),top-radius*Math.sin(a),a,smooth(0,.12,a)*(1-smooth(Math.PI-.12,Math.PI,a))];}
  distance-=arc;
  if(distance<straight) return [radius*2,top+distance,Math.PI,0];
  distance-=straight;
  if(distance<arc){const a=distance/radius;return [radius*(1+Math.cos(a)),bottom+radius*Math.sin(a),Math.PI+a,smooth(0,.12,a)*(1-smooth(Math.PI-.12,Math.PI,a))];}
  return [0,bottom-(distance-arc),Math.PI*2,0];
}
export function demoFlight(elapsed) {
  const t=clamp(elapsed,0,demoDuration);
  const routeEnd=545+1410+Math.PI*1040+2850+1440+85;
  const liftT=10, rollEnd=16, airEnd=104, v0=47;
  const firstDistance=.5*v0*liftT;
  const cruise=(routeEnd-firstDistance-.5*v0*(rollEnd-liftT)-.5*48*(airEnd-96))/(96-rollEnd+.5*(rollEnd-liftT)+.5*(airEnd-96));
  let distance, speed;
  if(t<liftT){speed=v0*t/liftT;distance=.5*speed*t;}
  else if(t<rollEnd){const e=t-liftT;speed=v0+(cruise-v0)*e/(rollEnd-liftT);distance=firstDistance+.5*(v0+speed)*e;}
  else if(t<96){speed=cruise;distance=firstDistance+.5*(v0+cruise)*(rollEnd-liftT)+cruise*(t-rollEnd);}
  else if(t<airEnd){const e=t-96;speed=cruise+(48-cruise)*e/(airEnd-96);distance=routeEnd-.5*(cruise+48)*(airEnd-96)+.5*(cruise+speed)*e;}
  else {const e=t-airEnd;speed=48*(1-e/(demoDuration-airEnd));distance=routeEnd+.5*(48+speed)*e;}
  const [x,z,heading,turn]=route(distance);
  const gear=1-smooth(14,17,t)+smooth(94,97,t);
  const y=runway.level+rideHeight({gear})+151*smooth(liftT,36,t)*(1-smooth(82,airEnd,t));
  const pitch=(.125*smooth(7,13,t)*(1-smooth(24,36,t))-.09*smooth(81,88,t)*(1-smooth(99,104,t))+.055*smooth(100,104,t)*(1-smooth(104,108,t)));
  return {x,y,z,heading,pitch,bank:turn*.37,speed,throttle:t<liftT?.96:t<80?.76:t<airEnd?.34:0,
    phase:t>=demoDuration?'complete':t>=airEnd?'landing':t>=liftT?'air':'ground', hasFlown:t>=liftT, landing:null,gear};
}
