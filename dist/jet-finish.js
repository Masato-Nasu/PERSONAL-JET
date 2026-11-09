import * as T from 'three';
import {canopyPanes} from './canopy-panes.js';

const width=950, height=560, pixelsPerMeter=950/10.4;
export function makeJetStencil(){
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#f00';ctx.strokeStyle='#0f0';ctx.lineWidth=3.2;ctx.lineJoin='round';
  for(const pane of canopyPanes){
    ctx.beginPath();
    pane.forEach(([x,,z],i)=>{
      const px=x*pixelsPerMeter+width*.5,py=z*pixelsPerMeter+height*.5;
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    });
    ctx.closePath();ctx.stroke();ctx.fill();
  }
  return canvas;
}

export function sampleJetStencil(canvas){
  const channels=canvas.getContext('2d').getImageData(0,0,width,height).data;
  return (x,y,z)=>{
    if(y<-.075)return [0,0];
    const px=Math.round(x*pixelsPerMeter+width*.5),py=Math.round(z*pixelsPerMeter+height*.5);
    if(px<0||py<0||px>=width||py>=height)return [0,0];
    const i=(py*width+px)*4;
    return [channels[i]/255,channels[i+1]/255];
  };
}

export function jetFinishMaterial(){
  const stencil=new T.CanvasTexture(makeJetStencil());
  stencil.minFilter=T.LinearMipmapLinearFilter;
  stencil.magFilter=T.LinearFilter;
  stencil.anisotropy=4;
  const material=new T.MeshPhysicalMaterial({
    color:0x4a5058,roughness:.36,metalness:.42,clearcoat:.47,clearcoatRoughness:.30,
    envMapIntensity:1.12,side:T.DoubleSide
  });
  material.onBeforeCompile=shader=>{
    shader.uniforms.jetStencil={value:stencil};
    shader.vertexShader=`
      attribute float jetOcclusion;
      varying vec3 jetPosition;
      varying float jetAO;
    `+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      jetPosition=position;
      jetAO=jetOcclusion;
    `);
    shader.fragmentShader=`
      uniform sampler2D jetStencil;
      varying vec3 jetPosition;
      varying float jetAO;
    `+shader.fragmentShader
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        vec2 jetUV=vec2(.5+jetPosition.x/10.4,.5-jetPosition.z/6.1305263);
        vec2 finish=texture2D(jetStencil,jetUV).rg*smoothstep(-.095,-.065,jetPosition.y);
        float glass=finish.r, seal=finish.g;
        float cavity=clamp(pow(max(.01,jetAO),2.0),.045,1.0);
        vec3 satin=diffuseColor.rgb*mix(.17,1.0,cavity);
        satin=mix(satin,vec3(.070,.078,.080),seal*.88);
        diffuseColor.rgb=mix(satin,vec3(.17,.23,.27),glass);
      `)
      .replace('#include <roughnessmap_fragment>',`
        #include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.53,(1.0-cavity)*.78);
        roughnessFactor=mix(roughnessFactor,.045,glass);
      `)
      .replace('#include <metalnessmap_fragment>',`
        #include <metalnessmap_fragment>
        metalnessFactor=mix(metalnessFactor,.86,glass);
      `)
      .replace('#include <lights_physical_fragment>',`
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= mix(.34,1.0,cavity);
          material.clearcoatRoughness=mix(material.clearcoatRoughness,.074,glass);
        #endif
      `)
      .replace('#include <aomap_fragment>',`
        #include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(.28,1.0,cavity);
        reflectedLight.indirectSpecular *= mix(.32,1.0,cavity);
      `)
      .replace('#include <opaque_fragment>',`
        if(glass>.001){
          vec3 reflected=inverseTransformDirection(reflect(-normalize(vViewPosition),normal),viewMatrix);
          float height=reflected.y;
          vec3 silver=mix(vec3(.066,.106,.127),vec3(.54,.57,.58),smoothstep(-.14,.025,height));
          silver=mix(silver,vec3(.137,.234,.32),smoothstep(.045,.79,height));
          float cloud=sin(19.0*height+3.4*reflected.x+1.9*sin(reflected.z*7.0));
          float sheen=smoothstep(.54,.92,cloud)*smoothstep(.02,.24,height)*(1.0-smoothstep(.49,.91,height));
          silver=mix(silver,vec3(.58,.66,.70),sheen*.52);
          silver+=vec3(.18,.19,.20)*pow(1.0-max(0.0,dot(normal,normalize(vViewPosition))),3.0);
          outgoingLight=mix(outgoingLight,mix(silver,outgoingLight,.24),glass);
        }
        #include <opaque_fragment>
      `);
  };
  return material;
}

export async function loadJetOcclusion(path){
  const response=await fetch(path);
  if(!response.ok)throw Error('Unable to load airframe surface shading');
  return new Uint8Array(await response.arrayBuffer());
}
