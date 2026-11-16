// Read-only acceptance helper: a terminal previous reply cannot satisfy the
// wait for a newly submitted message. Never submits or retries anything.
export async function waitForNewAssistantTurn(read, previousIds, { timeoutMs = 330000, pollMs = 250 } = {}) {
  const previous=new Set(previousIds),deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const current=(await read()).find(item=>!previous.has(item.id));
    if(current&&['succeeded','failed','interrupted','cancelled'].includes(current.status))return current;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  throw new Error('新对话等待超时，原请求保留，不自动重发。');
}
