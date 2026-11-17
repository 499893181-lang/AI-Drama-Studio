import http from 'node:http';
import {createHash,createPublicKey,randomBytes,randomUUID,timingSafeEqual,verify} from 'node:crypto';
import {AppError,now} from './store.mjs';
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const opaque=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function verifyIdToken(token,{jwks,clientId,nonce,subject,at=Date.now()}={}){
  try{
    const parts=token.split('.');if(parts.length!==3)throw Error();const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
    if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error();const key=jwks.keys?.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig'));
    if(!key||!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error();
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];if(claims.iss!==issuer||!audience.includes(clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=at||claims.nbf&&claims.nbf*1000>at+30000||typeof claims.sub!=='string'||!claims.sub||nonce&&!equal(claims.nonce,nonce)||subject&&claims.sub!==subject)throw Error();
    if(audience.length>1&&claims.azp!==clientId)throw Error();return claims;
  }catch{throw new AppError('OpenAI ID token 签名、身份、nonce、签发方、受众或有效期校验未通过；旧授权未被替换。',409);}
}
/** Own public-client OAuth registration; never reads Codex auth or browser cookies. */
export class SiwcManager{
  constructor(registry){this.registry=registry;this.pending=new Map();this.refreshing=new Map();}
  connection(id){const config=this.registry.config(),connection=config.connections.find(c=>c.id===id&&c.provider==='chatgpt-siwc');if(!connection)throw new AppError('请选择 Sign in with ChatGPT 文字连接。',404);return {config,connection};}
  hostId(){try{return this.registry.store.read('service-settings','siwc-host').hostId;}catch(error){if(error.status!==404)throw error;const record={id:'siwc-host',hostId:`urn:uuid:${randomUUID()}`,createdAt:now()};this.registry.store.write('service-settings',record);return record.hostId;}}
  async discovery(){const response=await this.registry.fetch(`${issuer}/.well-known/openid-configuration`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new AppError('无法读取 OpenAI 官方 OAuth 配置。',409);const value=await response.json();if(value.issuer!==issuer||value.authorization_endpoint!==`${issuer}/api/accounts/authorize`||value.token_endpoint!==`${issuer}/api/accounts/oauth/token`||new URL(value.jwks_uri).origin!==issuer)throw new AppError('官方 OAuth 端点校验失败。',409);return value;}
  async keys(discovery){const response=await this.registry.fetch(discovery.jwks_uri,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new AppError('无法读取 OpenAI 签名公钥。',409);return response.json();}
  async start(id){
    const {connection}=this.connection(id);if([...this.pending.values()].some(p=>p.connectionId===id))throw new AppError('此连接已有待完成的官方授权。',409);
    const discovery=await this.discovery(),hostId=this.hostId(),state=opaque(),nonce=opaque(),verifier=opaque(),attemptId=randomUUID(),clientId=connection.oauth?.clientId??connection.oauthPending?.clientId??null;
    const pending={attemptId,connectionId:id,connectionRevision:connection.revision,clientId,subject:connection.oauth?.subject??null,state,nonce,verifier,hostId,discovery,expiresAt:Date.now()+600000,used:false,server:null};
    const server=http.createServer(async(req,res)=>{
      res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
      try{const expectedHost=`127.0.0.1:${server.address().port}`;if(req.method!=='GET'||req.headers.host!==expectedHost)throw new AppError('授权回调来源无效。',403);const url=new URL(req.url,`http://${expectedHost}`);if(url.pathname!=='/auth/callback')throw new AppError('授权回调路径无效。',404);await this.complete(attemptId,url.searchParams);res.end('ChatGPT 授权校验已完成。请返回 AI 短剧查看连接状态；没有提交生成。');}
      catch(error){res.statusCode=error.status??400;res.end(error.status?error.message:'授权处理失败；没有保存新授权。');}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});pending.server=server;pending.redirectUri=`http://127.0.0.1:${server.address().port}/auth/callback`;
    const url=new URL(discovery.authorization_endpoint);const params={client_id:clientId??'dynamic_agent_client',response_type:'code',redirect_uri:pending.redirectUri,scope:scopes,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),ext_agent_host_id:hostId};if(!clientId)params.agent_name_hint='AI Drama Studio';for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);
    pending.timer=setTimeout(()=>this.stop(attemptId),600000);pending.timer.unref();this.pending.set(attemptId,pending);
    return {attemptId,authorizationUrl:url.href,expiresAt:new Date(pending.expiresAt).toISOString(),status:'awaiting_authorization',generationSubmitted:false};
  }
  stop(id){const pending=this.pending.get(id);if(!pending)return;clearTimeout(pending.timer);pending.server?.close();this.pending.delete(id);}
  async complete(attemptId,params){
    const pending=this.pending.get(attemptId);if(!pending||pending.used||Date.now()>pending.expiresAt)throw new AppError('授权已过期或已处理，请重新发起。',409);
    if(!equal(params.get('state'),pending.state))throw new AppError('授权 state 不匹配；未交换令牌。',403);pending.used=true;
    try{
      if(params.has('error'))throw new AppError(params.get('error')==='access_denied'?'本人未批准 ChatGPT 授权；保留旧连接。':'官方授权返回错误；未生成。',409);
      const callbackClient=params.get('client_id'),clientId=pending.clientId??callbackClient;
      if(!clientId||clientId==='dynamic_agent_client'||pending.clientId&&callbackClient&&callbackClient!==pending.clientId)throw new AppError('缺少新发放 client_id 或回调试图替换旧注册。',409);
      if(!pending.clientId){const {config,connection}=this.connection(pending.connectionId);if(connection.revision!==pending.connectionRevision)throw new AppError('授权期间连接改变。',409);connection.oauthPending={clientId,registrationState:'issued_not_identity_validated',at:now()};connection.revision++;pending.connectionRevision=connection.revision;this.registry.save(config);}
      const code=params.get('code');if(!code||code.length>12000)throw new AppError('授权回调没有有效 code。',409);
      const response=await this.registry.fetch(pending.discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource}),redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new AppError(`官方令牌交换 HTTP ${response.status}；需重新授权，不自动重用 code。`,409);
      const tokens=await response.json(),keys=await this.keys(pending.discovery),identity=verifyIdToken(tokens.id_token,{jwks:keys,clientId,nonce:pending.nonce,subject:pending.subject});
      const granted=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[];if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke')||typeof tokens.access_token!=='string'||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new AppError('身份已返回，但没有授予完整 ChatGPT 文字用量权限及有效期；没有接通推理。',409);
      const {config,connection}=this.connection(pending.connectionId);if(connection.revision!==pending.connectionRevision)throw new AppError('授权期间连接已修改，请重新授权；未覆盖新配置。',409);
      const record={...tokens,client_id:clientId,subject:identity.sub,email:identity.email??null,issuer,ext_agent_host_id:pending.hostId,scopes:granted,savedAt:now(),expiresAt:Date.now()+Number(tokens.expires_in??0)*1000};
      const ref=await this.registry.vault.put(JSON.stringify(record));this.registry.check(this.registry.config(),config.revision);connection.credentialRef=ref;connection.oauth={clientId,subject:identity.sub,email:identity.email??null,hostId:pending.hostId,scopes:granted,expiresAt:new Date(record.expiresAt).toISOString(),authorizedAt:now()};connection.revision++;connection.statuses={...connection.statuses,authentication:'authenticated',permission:'text_plan_scope_granted',serviceConnection:'not_verified',realGeneration:'not_verified'};delete connection.blockedReason;delete connection.oauthPending;this.registry.save(config);return this.registry.publicConnection(connection);
    }finally{this.stop(attemptId);}
  }
  async accessToken(id){
    const {connection}=this.connection(id);if(!connection.credentialRef)throw new AppError('待配置：请本人完成此应用的 Continue with ChatGPT 授权。',409);const record=JSON.parse(await this.registry.vault.get(connection.credentialRef));
    if(record.client_id!==connection.oauth?.clientId||record.subject!==connection.oauth?.subject||!record.scopes?.includes('chatgpt.tokens.use.direct'))throw new AppError('ChatGPT 授权记录与所选账号注册不一致。',409);
    if(record.expiresAt>Date.now()+60000)return record.access_token;
    if(!this.refreshing.has(id))this.refreshing.set(id,this.refresh(id,record).finally(()=>this.refreshing.delete(id)));return this.refreshing.get(id);
  }
  async refresh(id,record){
    if(!record.refresh_token)throw new AppError('ChatGPT 授权过期且无可续期凭据，请重新授权。',409);const discovery=await this.discovery();const response=await this.registry.fetch(discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:record.client_id,refresh_token:record.refresh_token,resource}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new AppError(`ChatGPT 授权续期 HTTP ${response.status}，请重新授权；未提交生成。`,409);const tokens=await response.json();if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string'||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new AppError('续期缺少实际替换凭据或有效期。',409);if(tokens.id_token)verifyIdToken(tokens.id_token,{jwks:await this.keys(discovery),clientId:record.client_id,subject:record.subject});const granted=tokens.scope?tokens.scope.split(/\s+/):record.scopes;if(!granted.includes('chatgpt.tokens.use.direct')||!granted.includes('resource.invoke'))throw new AppError('ChatGPT 文字用量权限已撤销。',409);
    const {config,connection}=this.connection(id);if(connection.oauth?.clientId!==record.client_id||connection.oauth?.subject!==record.subject)throw new AppError('续期期间账号改变。',409);const value={...record,...tokens,scopes:granted,savedAt:now(),expiresAt:Date.now()+Number(tokens.expires_in??0)*1000},ref=await this.registry.vault.put(JSON.stringify(value));this.registry.check(this.registry.config(),config.revision);connection.credentialRef=ref;connection.oauth.expiresAt=new Date(value.expiresAt).toISOString();this.registry.save(config);return value.access_token;
  }
  async inspect(id){const token=await this.accessToken(id),response=await this.registry.fetch(`${resource}/models`,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new AppError(`ChatGPT 账号目录 HTTP ${response.status}。`,409);const raw=await response.json();if(!Array.isArray(raw.models))throw new AppError('ChatGPT 账号目录缺少实际 models 数组；未借用 API Key 目录。',409);const {config,connection}=this.connection(id);connection.accountModels=raw.models.filter(model=>model.visibility==='list').map(model=>({id:model.slug,name:model.display_name??model.slug}));connection.statuses={...connection.statuses,serviceConnection:'catalog_connected',realGeneration:'not_verified'};this.registry.save(config);return this.registry.publicConnection(connection);}
  close(){for(const id of this.pending.keys())this.stop(id);}
}
