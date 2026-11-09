import * as T from 'three';
import {clamp, runway} from './physics.js';
const sun = new T.Vector3(-.67,.105,-.735).normalize();
const horizon = new T.Color('#9f9a8b');
const mix = (a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
let seed=1108;
function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const noiseGLSL = `
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.55+noise(p*2.08+7.)*.26+noise(p*4.25-5.)*.125+noise(p*8.73)*.065;}
`;
export function heightAt(x,z){
  const c=x-150-145*Math.sin(z/550);
  const land=1-(c/1090)**2-(z/1740)**2+.095*Math.sin(x/125+z/229)+.058*Math.sin(z/93-x/268)+.06*Math.cos(z/252);
  const island = Math.max(-20, 46*land-5);
  const ridge=135*Math.exp(-(((x-740)/320)**2+((z+190)/810)**2))*(.78+.18*Math.sin(z/215)+.08*Math.cos(x/82+z/114));
  const apr=1-smooth(.83,1.28,Math.max(Math.abs(x-75)/275,Math.abs(z)/795));
  return Math.max(0,mix(island+ridge,runway.level,apr));
}
const atmosphereVertex=`
varying vec3 world;
void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}
`;
function makeSky(scene){
  const material=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{sun:{value:sun},clock:{value:0}},vertexShader:atmosphereVertex,fragmentShader:`
uniform vec3 sun; uniform float clock; varying vec3 world;
${noiseGLSL}
void main(){
  vec3 d=normalize(world-cameraPosition);
  float y=max(0.,d.y), facing=max(0.,dot(d,sun));
  vec3 haze=mix(vec3(.45,.48,.49),vec3(.95,.61,.35),pow(facing,6.));
  vec3 col=mix(haze,vec3(.06,.19,.34),pow(smoothstep(0.,.95,y),.63));
  col+=vec3(.25,.102,.025)*pow(facing,15.)*exp(-y*2.);
  vec2 uv=d.xz/(max(d.y,0.)+.13)*2.55+vec2(clock*.007,1.7);
  float n=fbm(uv+vec2(noise(uv*.41),noise(uv*.47+2.)));
  float shade=fbm(uv-vec2(.1,.2));
  float cover=smoothstep(.47,.64,n)*smoothstep(.018,.115,y)*(1.-.65*smoothstep(.75,1.,y));
  vec3 dark=mix(vec3(.22,.29,.39),vec3(.43,.36,.33),pow(facing,4.));
  vec3 light=mix(vec3(.63,.67,.69),vec3(1.14,.76,.49),pow(facing,5.));
  col=mix(col,mix(dark,light,smoothstep(.44,.69,shade)),cover*.92);
  col+=vec3(1.25,.62,.23)*pow(facing,430.)+vec3(6.,3.7,1.6)*smoothstep(.99988,.99994,facing);
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`});
  const sky=new T.Mesh(new T.SphereGeometry(13500,24,14),material);sky.frustumCulled=false;sky.renderOrder=-30;scene.add(sky);return sky;
}
function makeSea(scene){
  const material=new T.ShaderMaterial({uniforms:{sun:{value:sun},clock:{value:0}},vertexShader:atmosphereVertex,fragmentShader:`
uniform vec3 sun; uniform float clock; varying vec3 world;
${noiseGLSL}
void main(){
  vec2 p=world.xz;
  vec3 eye=normalize(cameraPosition-world);
  float distanceToEye=length(cameraPosition-world);
  float t=clock;
  float a=sin(dot(p,vec2(.154,.074))+t*1.57);
  float b=sin(dot(p,vec2(-.045,.39))-t*2.2+a*.5);
  float c=sin(dot(p,vec2(.97,-.37))+t*2.2+b*.42);
  vec3 n=normalize(vec3(.085*a+.055*c,1.,.17*b+.055*c));
  float ndv=clamp(dot(n,eye),0.,1.);
  float fresnel=pow(1.-ndv,4.);
  vec3 reflected=reflect(-eye,n);
  float glint=max(0.,dot(reflected,sun));
  float broad=pow(max(0.,dot(normalize(vec3(-eye.x,.12,-eye.z)),sun)),12.);
  vec3 col=mix(vec3(.024,.133,.153),vec3(.21,.34,.41),fresnel*.89);
  col*=.89+.21*noise(p*.097+vec2(t*.16,.0))+.05*a;
  col+=vec3(.7,.36,.135)*broad*.28*fresnel;
  col+=vec3(1.82,.91,.37)*(pow(glint,92.)*.76+pow(glint,420.)*1.65);
  float cx=p.x-150.-145.*sin(p.y/550.);
  float edge=46.*(1.-(cx*cx/1188100.)-(p.y*p.y/3027600.)+.095*sin(p.x/125.+p.y/229.)+.058*sin(p.y/93.-p.x/268.)+.06*cos(p.y/252.))-5.;
  float shore=1.-smoothstep(0.,3.5,abs(edge+.29*sin(t*1.2+p.x*.045)));
  col+=vec3(.34,.48,.44)*shore*(.25+.75*smoothstep(.5,.75,noise(p*.11)));
  float haze=smoothstep(900.,10800.,distanceToEye);
  col=mix(col,vec3(.45,.47,.47)+vec3(.28,.12,.033)*broad,haze*.89);
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`});
  const sea=new T.Mesh(new T.PlaneGeometry(23000,23000),material);sea.rotation.x=-Math.PI/2;sea.position.y=-.09;scene.add(sea);return sea;
}
function canvasTexture(width,height,paint){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  paint(canvas.getContext('2d'),width,height);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=6;return texture;
}
function runwayTexture(){
  return canvasTexture(256,4096,(ctx,w,h)=>{
    const pixels=ctx.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=(y*w+x)*4;
      const worn=(Math.exp(-(((x-110)/14)**2))+Math.exp(-(((x-146)/14)**2)))*9*(.45+.55*Math.cos(y/330)**2);
      const value=77+(rand()-.5)*26+4*Math.sin(y/181)+3*Math.cos(x/6)-worn;
      pixels.data[p]=value+6;pixels.data[p+1]=value+5;pixels.data[p+2]=value+2;pixels.data[p+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    ctx.fillStyle='#26272730';for(let y=75;y<h;y+=98)ctx.fillRect(0,y,w,2);
    ctx.fillStyle='#e6dcc6';ctx.fillRect(13,6,3,h-12);ctx.fillRect(w-16,6,3,h-12);
    for(let y=185;y<h-175;y+=125)ctx.fillRect(w/2-2,y,4,60);
    for(const flip of [false,true]){
      ctx.save();if(flip){ctx.translate(w,h);ctx.rotate(Math.PI);}
      for(let i=0;i<10;i++)ctx.fillRect(43+i*18,28,10,43);
      ctx.font='bold 51px Helvetica';ctx.textAlign='center';ctx.fillText(flip?'36':'18',w/2,137);
      for(const x of [75,169]){ctx.fillRect(x,240,12,68);ctx.fillRect(x-14,390,5,38);ctx.fillRect(x+20,390,5,38);}
      ctx.restore();
    }
  });
}
function terrain(scene) {
  const geo=new T.PlaneGeometry(3900,4700,220,240);
  geo.rotateX(-Math.PI/2);
  const v=geo.attributes.position, rgb=[];
  const grass=new T.Color('#646747'), forest=new T.Color('#4d6143'), sand=new T.Color('#a59d76'), rock=new T.Color('#77716a'), muted=new T.Color('#7e7a53');
  const color=new T.Color();
  for(let i=0;i<v.count;i++){
    const x=v.getX(i),z=v.getZ(i), h=heightAt(x,z), slope=Math.hypot(heightAt(x+6,z)-h,heightAt(x,z+6)-h)/6;
    v.setY(i,h===0?-2.8:h-.025);
    const variation=.5+.24*Math.sin(x/43+z/60)+.19*Math.cos(z/27-x/65);
    color.copy(grass).lerp(forest,variation).lerp(muted,.25+.2*Math.sin(x/17+z/32));
    color.lerp(sand,(1-smooth(1.5,11,h))*.9).lerp(rock,smooth(.27,.75,slope)*.85);
    rgb.push(color.r,color.g,color.b);
  }
  geo.setAttribute('color',new T.Float32BufferAttribute(rgb,3));geo.computeVertexNormals();
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:1});
  material.onBeforeCompile=(shader)=>{
    shader.vertexShader='varying vec2 terrainPos;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainPos=position.xz;');
    shader.fragmentShader='varying vec2 terrainPos;\n'+noiseGLSL+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb*=.71+.35*fbm(terrainPos*.088)+.30*noise(terrainPos*1.53);');
  };
  scene.add(new T.Mesh(geo,material));
}
function box(scene,x,y,z,w,h,l,color,rotation=0){
  const mesh=new T.Mesh(new T.BoxGeometry(w,h,l),new T.MeshStandardMaterial({color,roughness:.81}));
  mesh.position.set(x,y,z);mesh.rotation.y=rotation;scene.add(mesh);return mesh;
}
function flat(scene,x,y,z,w,l,material){
  const mesh=new T.Mesh(new T.PlaneGeometry(w,l),material);mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,z);scene.add(mesh);return mesh;
}
function airfield(scene){
  const asphalt=new T.MeshStandardMaterial({color:0xdcd6cd,map:runwayTexture(),roughness:.96});
  flat(scene,0,8.065,0,46,1300,asphalt);
  const apron=new T.MeshStandardMaterial({color:'#777570',roughness:.94});
  flat(scene,100,8.04,244,133,252,apron);
  flat(scene,36,8.05,306,71,19,apron);
  const yellow=new T.MeshBasicMaterial({color:'#cba75d'});
  flat(scene,50,8.064,306,54,.20,yellow);flat(scene,91,8.065,275,.20,61,yellow);
  for(let i=0;i<3;i++){
    const x=123+i*20;
    box(scene,x,13.7,161,17,11.4,29,i%2?'#686c66':'#7f8178');
    box(scene,x,18.91,161,18,.6,30,'#484e50');
    box(scene,x,12,175.58,12,7,.22,'#3d4446');
    for(let j=-3;j<=3;j++)box(scene,x+j*1.65,12,175.74,.045,6.9,.11,'#6a6c66');
    flat(scene,x,8.061,203,11,.19,yellow);
  }
  box(scene,79,16.25,226,7.4,16.5,7.4,'#887f6e');
  box(scene,79,25.8,226,9.6,3.1,9.5,'#394d58');
  box(scene,79,27.5,226,10,.5,10,'#75746b');
  box(scene,79,29,226,.28,3,.26,'#625f55');
  const lightGeo=new T.BoxGeometry(.28,.17,.25), lamps=[];
  for(let z=-641;z<=642;z+=32)for(const x of [-23.5,23.5])lamps.push([x,8.18,z,'#ffd8a5']);
  for(let x=-19;x<=19;x+=3.8){lamps.push([x,8.19,-644,'#ff6250']);lamps.push([x,8.19,644,'#91ffb9']);}
  const lights=new T.InstancedMesh(lightGeo,new T.MeshBasicMaterial(),lamps.length);
  const dummy=new T.Object3D();
  lamps.forEach(([x,y,z,color],i)=>{dummy.position.set(x,y,z);dummy.updateMatrix();lights.setMatrixAt(i,dummy.matrix);lights.setColorAt(i,new T.Color(color));});
  scene.add(lights);
}
function vegetation(scene){
  const crown=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:0xffffff,roughness:1}),1050);
  const trunks=new T.InstancedMesh(new T.CylinderGeometry(.11,.22,1,5),new T.MeshStandardMaterial({color:'#655847',roughness:1}),1050);
  const dummy=new T.Object3D(); const a=new T.Color('#454c33'), b=new T.Color('#647151');let i=0;
  while(i<1050){
    const x=(rand()-.5)*2100+150,z=(rand()-.5)*3250, y=heightAt(x,z);
    if(y<16 || (Math.abs(z)<860 && x>-250 && x<420)) continue;
    const size=1.3+3.65*rand(), width=.7+rand()*.44;
    dummy.rotation.set(0,rand()*6.28,0);
    dummy.position.set(x,y+size*.73,z);dummy.scale.set(size*.58*width,size*.66,size*.6*width);dummy.updateMatrix();crown.setMatrixAt(i,dummy.matrix);
    crown.setColorAt(i,a.clone().lerp(b,rand()));
    dummy.position.y=y+size*.24;dummy.scale.set(size*.34,size*.48,size*.34);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    i++;
  }
  scene.add(crown,trunks);
}
export function createWorld(scene,renderer){
  scene.fog=new T.FogExp2(horizon,.00049);
  scene.add(new T.HemisphereLight(0xdbeaff,0x716044,2.12));
  const key=new T.DirectionalLight(0xffdbaf,3.15);key.position.copy(sun).multiplyScalar(500);scene.add(key);
  const fill=new T.DirectionalLight(0xb8d7ff,.42);fill.position.set(500,100,500);scene.add(fill);
  const sky=makeSky(scene),sea=makeSea(scene);
  const lightingScene=new T.Scene();
  const lightingSky=makeSky(lightingScene);
  const pmrem=new T.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(lightingScene,.09,.1,14500,{size:128}).texture;
  scene.environmentIntensity=.62;
  lightingSky.geometry.dispose();lightingSky.material.dispose();pmrem.dispose();
  terrain(scene);airfield(scene);vegetation(scene);
  return (camera,time)=>{sky.position.copy(camera.position);sky.material.uniforms.clock.value=time;sea.material.uniforms.clock.value=time;};
}
