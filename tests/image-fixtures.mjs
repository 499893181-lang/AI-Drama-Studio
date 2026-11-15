// Actual PNG pixels explicitly say TEST FIXTURE / NOT AI. No generator is used.
import { deflateSync } from 'node:zlib';
import { crc32 } from '../src/image-files.mjs';
const glyphs={T:['11111','00100','00100','00100','00100','00100','00100'],E:['11111','10000','10000','11110','10000','10000','11111'],S:['01111','10000','10000','01110','00001','00001','11110'],F:['11111','10000','10000','11110','10000','10000','10000'],I:['11111','00100','00100','00100','00100','00100','11111'],X:['10001','10001','01010','00100','01010','10001','10001'],U:['10001','10001','10001','10001','10001','10001','01110'],R:['11110','10001','10001','11110','10100','10010','10001'],N:['10001','11001','11001','10101','10011','10011','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],A:['01110','10001','10001','11111','10001','10001','10001'],' ':['00000','00000','00000','00000','00000','00000','00000']};
function chunk(type,data){const name=Buffer.from(type),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,crc]);}
export function testPng(width=320,height=180,color=[44,64,98]) {
  const rowBytes=width*3+1,raw=Buffer.alloc(rowBytes*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pos=y*rowBytes+1+x*3;raw[pos]=color[0];raw[pos+1]=color[1];raw[pos+2]=color[2];}
  const scale=Math.max(1,Math.min(3,Math.floor(width/80))),lines=['TEST FIXTURE','NOT AI'];
  for(let line=0;line<lines.length;line++) for(let index=0;index<lines[line].length;index++) {
    const glyph=glyphs[lines[line][index]];
    for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(glyph[gy][gx]==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const x=8+index*6*scale+gx*scale+dx,y=8+line*10*scale+gy*scale+dy;if(x>=width||y>=height)continue;const pos=y*rowBytes+1+x*3;raw[pos]=255;raw[pos+1]=245;raw[pos+2]=230;
    }
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Source\0SOFTWARE TEST FIXTURE; NOT AI GENERATED')),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
