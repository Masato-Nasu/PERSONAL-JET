import * as T from 'three';
import {gunMuzzles} from './gun-mounts.js';

const alloys={
  shell:new T.MeshStandardMaterial({color:0x515860,metalness:.75,roughness:.37}),
  lip:new T.MeshStandardMaterial({color:0x84817b,metalness:.76,roughness:.28}),
  liner:new T.MeshStandardMaterial({color:0x303940,metalness:.64,roughness:.62,side:T.DoubleSide}),
  dark:new T.MeshStandardMaterial({color:0x1d2226,metalness:.42,roughness:.52}),
  steel:new T.MeshStandardMaterial({color:0x8e9da3,metalness:.60,roughness:.28}),
  rubber:new T.MeshStandardMaterial({color:0x25272a,roughness:.88})
};

function part(parent,geometry,material,x=0,y=0,z=0){
  const mesh=new T.Mesh(geometry,material);
  mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}

function cylinder(parent,radiusA,radiusB,length,material,x,y,z,axis,open=false,sides=12){
  const geometry=new T.CylinderGeometry(radiusA,radiusB,length,sides,1,open);
  if(axis==='z')geometry.rotateX(Math.PI/2);
  if(axis==='x')geometry.rotateZ(Math.PI/2);
  return part(parent,geometry,material,x,y,z);
}

function rod(parent,a,b,radius,material){
  const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);
  const mesh=cylinder(parent,radius,radius,delta.length(),material,...start.lerp(end,.5));
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());
}

function gun(parent,[x,y,z]){
  cylinder(parent,.098,.075,.20,alloys.shell,x,y,z+.53,'z',false,16);
  cylinder(parent,.057,.050,.26,alloys.dark,x,y,z+.40,'z',false,16);
  cylinder(parent,.035,.032,.38,alloys.steel,x,y,z+.221,'z',false,16);
  cylinder(parent,.048,.045,.077,alloys.shell,x,y,z+.039,'z',true,16);
  part(parent,new T.TorusGeometry(.036,.009,6,16),alloys.steel,x,y,z+.009);
  cylinder(parent,.036,.036,.009,alloys.dark,x,y,z+.024,'z');
}

function engine(parent,x){
  const mount=new T.Group();
  mount.position.set(x,.025,.88);mount.rotation.x=-.07;parent.add(mount);
  cylinder(mount,.147,.154,.25,alloys.shell,0,0,-.07,'z',true,20);
  // The cone faces the exhaust opening. The petals sit on the outer wall.
  const linerGeometry=new T.CylinderGeometry(.123,.078,.177,20,1,true);
  linerGeometry.rotateX(-Math.PI/2);
  part(mount,linerGeometry,alloys.liner,0,0,-.037);
  cylinder(mount,.080,.080,.016,alloys.dark,0,0,-.132,'z');
  part(mount,new T.TorusGeometry(.134,.015,5,20),alloys.lip,0,0,.056);
  part(mount,new T.TorusGeometry(.149,.009,4,20),alloys.shell,0,0,-.025);
  for(let i=0;i<10;i++){
    const angle=i*Math.PI/5;
    const petal=part(mount,new T.BoxGeometry(.027,.019,.103),i%2?alloys.shell:alloys.liner,
      Math.sin(angle)*.145,Math.cos(angle)*.145,.003);
    petal.rotation.z=-angle;
  }
  const plume=new T.Group();plume.position.z=.064;mount.add(plume);
  const segments=[
    [.123,.165,0,.36,0xffb08a,.50], [.165,.110,.36,.76,0xf27854,.31],
    [.110,.109,.76,1.35,0xef775a,.28], [.109,.064,1.35,2.16,0xab83f9,.27],
    [.064,.026,2.16,2.83,0x9d85f5,.19], [.026,.002,2.83,3.40,0x8d9bff,.10],
    [.090,.027,0,.54,0xffdcac,.89], [.055,.021,.49,.87,0xffb48a,.66],
    [.066,.018,.88,1.33,0xffaf85,.60], [.043,.007,1.42,1.92,0xff987a,.44]
  ].map(([a,b,start,end,color,strength])=>{
    const mat=new T.MeshBasicMaterial({color,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false});
    cylinder(plume,b,a,end-start,mat,0,0,(start+end)/2,'z',true,10);
    return {mat,strength};
  });
  return {plume,segments};
}

function leg(parent,x,z,nose=false){
  const hinge=new T.Group(), wheel=new T.Group();
  const radius=nose?.145:.195, width=nose?.11:.139;
  const y=-.96+radius+.19;
  hinge.position.set(x,-.19,z);parent.add(hinge);
  rod(hinge,[0,0,0],[0,y+.15,.02],nose?.055:.071,alloys.shell);
  rod(hinge,[0,y+.28,.015],[0,y,.03],nose?.033:.046,alloys.steel);
  rod(hinge,[0,-.065,.24],[0,y+.14,.02],.024,alloys.shell);
  rod(hinge,[width*.6,y+.105,.015],[width*.6,y,.03],.023,alloys.dark);
  wheel.position.set(0,y,.03);hinge.add(wheel);
  cylinder(wheel,radius,radius,width,alloys.rubber,0,0,0,'x',false,16);
  for(const side of [-1,1]){
    cylinder(wheel,radius*.61,radius*.61,.012,alloys.liner,side*width*.51,0,0,'x');
    cylinder(wheel,radius*.38,radius*.38,.017,alloys.steel,side*width*.57,0,0,'x');
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2;
      cylinder(wheel,.013,.013,.011,alloys.dark,side*width*.63,Math.sin(a)*radius*.45,Math.cos(a)*radius*.45,'x',false,6);
    }
  }
  return {hinge,wheel,radius};
}

export function createJetHardware(airframe){
  const group=new T.Group();airframe.add(group);
  for(const muzzle of gunMuzzles)gun(group,muzzle);
  const engines=[engine(group,-1.35),engine(group,1.35)];
  const legs=[leg(group,0,-1.10,true),leg(group,-1.31,.48),leg(group,1.31,.48)];
  return {group,update(flight,time,dt){
    const gear=flight.gear??0;
    for(const [i,{hinge,wheel,radius}] of legs.entries()){
      hinge.visible=gear>.018;
      hinge.rotation.x=(1-gear)*(i===0?1.52:-1.52);
      hinge.scale.setScalar(.19+.81*gear);
      if(flight.phase!=='air')wheel.rotation.x-=flight.speed*dt/radius;
    }
    const power=flight.throttle??0;
    for(const [i,{plume,segments}] of engines.entries()){
      plume.visible=power>.04;
      const flicker=.94+.045*Math.sin(time*54+i*2)+.025*Math.sin(time*87+i*4);
      plume.scale.set(.78+power*.24,.78+power*.24,(.42+power*.95)*flicker);
      for(const {mat,strength} of segments)mat.opacity=strength*(.22+.78*power)*flicker;
    }
  }};
}
