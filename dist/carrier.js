import {initialFlight,rideHeight} from './physics.js?v=carrier-deck';

export const carrierDeck={x:-2450,z:580,level:19,halfWidth:13,halfLength:136,carrier:true};
const deckOutline=[
  [-27,142],[27,142],[35,121],[35,-86],[22,-132],[9,-154],
  [-11,-154],[-27,-128],[-35,-86],[-35,121]
];

export function deckHeight(x,z){
  const dx=x-carrierDeck.x,dz=z-carrierDeck.z;
  return deckOutline.every(([ax,az],i)=>{
    const [bx,bz]=deckOutline[(i+1)%deckOutline.length];
    return (bx-ax)*(dz-az)-(bz-az)*(dx-ax)<=0;
  })?carrierDeck.level:0;
}

export function initialCarrierFlight(){
  const flight=initialFlight();
  flight.x=carrierDeck.x;
  flight.z=carrierDeck.z+105;
  flight.y=carrierDeck.level+rideHeight(flight);
  return flight;
}

export function carrierSurfaces(){
  const hull=[], markings=[], island=[];
  const {x,z,level}=carrierDeck;
  function face(group,color,points){
    group.push({color,points:points.map(([px,y,pz])=>[px+x,y,pz+z])});
  }
  function slab(group,color,points,low,high,top=color){
    if(top)face(group,top,points.map(([x,z])=>[x,high,z]));
    for(let i=0;i<points.length;i++){
      const [a,b]=points[i],[c,d]=points[(i+1)%points.length];
      face(group,color,[[a,high,b],[a,low,b],[c,low,d],[c,high,d]]);
    }
  }
  function rectangle(x,z,w,length){
    return [[x-w/2,z+length/2],[x+w/2,z+length/2],[x+w/2,z-length/2],[x-w/2,z-length/2]];
  }
  const hullOutline=deckOutline.map(([x,z])=>[x*.68,z*.95]);
  slab(hull,'#343e47',hullOutline,-3,15,null);
  slab(hull,'#59636c',deckOutline,15,level,'#383e44');
  const stripe=(x,z,w,l,c='#e7e4d7',y=level+.035)=>face(markings,c,rectangle(x,z,w,l).map(([x,z])=>[x,y,z]));
  for(const side of [-1,1]){
    stripe(side*13,3,.34,248);
    stripe(side*29,18,.42,194,'#d0a260');
    for(let z=-75;z<=128;z+=14)stripe(side*30,z,1.05,.82,'#d5dec9',level+.05);
  }
  for(let z=-124;z<132;z+=13)stripe(0,z,.42,6.2);
  for(const z of [62,55,48,41])stripe(0,z,26,.24,'#d4d0bc',level+.055);
  for(const x of [-10,-7,7,10])stripe(x,128,1,5);
  stripe(0,134,25,.75);
  stripe(-22,48,9,38,'#4b5158',level+.025);
  stripe(0,-71,.17,83,'#9ba4a8',level+.055);
  // Starboard island, bridge glazing, exhaust and radar mast.
  slab(island,'#686f75',rectangle(24,-19,9,34),level,level+8,'#8b9090');
  slab(island,'#798185',rectangle(24,-26,10,17),level+8,level+13,'#909698');
  slab(island,'#263d4b',rectangle(24,-26,10.24,17.24),level+9.7,level+11.45);
  slab(island,'#535e64',rectangle(25,-11,5,6),level+8,level+14,'#252d32');
  slab(island,'#8a9195',rectangle(24,-29,1.1,1.1),level+13,level+25);
  slab(island,'#adb4b7',rectangle(24,-29,10,1.05),level+23,level+24);
  slab(island,'#bfc4c4',rectangle(24,-29,5,1.8),level+20,level+21);
  return [hull,markings,island];
}
