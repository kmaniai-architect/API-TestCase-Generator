/* ---------- generator ---------- */
function generate(method,endpoint,req,res){
  const list=[]; let n=0;
  const add=(category,title,type,request,status,expected,priority,source,opts={})=>{
    list.push({id:'TC'+String(++n).padStart(3,'0'),category,title,type,source,
      method:opts.method||method,endpoint:opts.endpoint||endpoint,request:request??'—',status,expected,priority,steps:opts.steps});
  };
  const hasBody=['POST','PUT','PATCH'].includes(method);
  const hasId = res && typeof res==='object' && !Array.isArray(res) && 'id' in res;
  const okStatus = method==='POST'?(hasId?'201 Created':'200 / 201'):method==='DELETE'?'200 / 204':'200 OK';
  const pathParam=/\{[^}]+\}|\/\d+(\/|$|\?)/.test(endpoint);
  const hdr='Authorization: Bearer <valid_token>\nContent-Type: application/json';

  add('Functional',`Valid ${method} request returns success`,'Positive',hasBody?{headers:hdr,body:req}:hdr,okStatus,
    method==='GET'?'Response body matches the provided response schema and values':
    method==='POST'?'Resource created; response body matches the provided response':
    method==='DELETE'?'Resource deleted; subsequent GET returns 404':'Resource updated; response reflects new values','High','General');

  /* ===== RESPONSE based ===== */
  if(res!==undefined){
    add('Response Validation','Content-Type is application/json','Positive','Valid request',okStatus,'Header Content-Type contains application/json','Medium','Response');
    const isArr=Array.isArray(res), sample=isArr?res[0]:res;
    if(isArr){
      add('Response Validation','Response is a JSON array','Positive','Valid request',okStatus,`Body is an array${res.length?` (sample: ${res.length} item${res.length>1?'s':''})`:''}`,'High','Response');
      if(method==='GET'){
        add('Pagination','Pagination with limit & page','Positive',{query:'?page=1&limit=5'},'200 OK','At most 5 items returned','Medium','Response');
        add('Pagination','Invalid limit (negative)','Negative',{query:'?limit=-1'},'400 Bad Request','Validation error returned','Medium','Response');
        add('Pagination','Page beyond last page','Negative',{query:'?page=99999'},'200 OK','Empty array, no server error','Low','Response');
        add('Filtering','Unknown filter parameter','Negative',{query:'?unknownParam=xyz'},'200 / 400','No 5xx; consistent behaviour','Low','Response');
        add('Sorting','Sort by a response field','Positive',{query:`?sort=${sample&&Object.keys(sample)[0]||'id'}&order=desc`},'200 OK','Items returned in descending order','Low','Response');
      }
    }
    if(sample&&typeof sample==='object'){
      add('Response Validation','All expected top-level fields present','Positive','Valid request',okStatus,`Fields: ${Object.keys(sample).join(', ')}`,'High','Response');
      add('Response Validation','No unexpected extra fields in response','Positive','Valid request',okStatus,'Response keys match the documented contract','Low','Response');
      for(const l of leaves(sample)){
        const p=l.path.join('.'), t=typeOf(l.value);
        add('Response Validation',`Field "${p}" is ${t}`,'Positive','Valid request',okStatus,
          `${p} is ${t}${l.value!==null&&typeof l.value!=='object'?` (e.g. ${JSON.stringify(l.value)})`:''}`,/(^|\.)id$/i.test(p)?'High':'Medium','Response');
        if(t==='string'&&/email/i.test(p)) add('Response Validation',`"${p}" is valid email`,'Positive','Valid request',okStatus,`${p} matches email pattern`,'Low','Response');
        if(t==='string'&&/(date|time|_at$|At$)/.test(p)) add('Response Validation',`"${p}" is ISO-8601 date`,'Positive','Valid request',okStatus,`${p} parses as a valid date`,'Low','Response');
        if(t==='string'&&/(pass|secret|token|hash)/i.test(p)) add('Security',`"${p}" must not be exposed`,'Negative','Valid request',okStatus,`${p} absent from response`,'High','Response');
        if(t==='null') add('Response Validation',`Nullable field "${p}"`,'Positive','Valid request',okStatus,`${p} may be null – consumers handle it`,'Low','Response');
      }
      for(const k of Object.keys(sample)) if(Array.isArray(sample[k]))
        add('Response Validation',`Array "${k}" items are consistent`,'Positive','Valid request',okStatus,`Every item in ${k} has same keys & types`,'Medium','Response');
      if(hasBody&&req&&typeof req==='object'&&!Array.isArray(req)){
        for(const l of leaves(req)){
          const p=l.path.join('.');
          if(getAt(sample,l.path)!==undefined)
            add('Request ↔ Response',`Response echoes "${p}" from request`,'Positive',{body:req},okStatus,`response.${p} equals ${JSON.stringify(l.value)}`,'High','Response');
        }
        if(hasId&&method==='POST') add('Request ↔ Response','Generated id is returned and fetchable','Positive',{note:'POST then GET /{id}'},'201 then 200','GET returns the same data as the created resource','High','Response');
        if(method==='PATCH') add('Request ↔ Response','Fields not in request remain unchanged in response','Positive',{body:req},okStatus,'Untouched fields keep previous values','High','Response');
      }
    }
  }

  /* ===== REQUEST based ===== */
  if(hasBody&&req&&typeof req==='object'&&!Array.isArray(req)){
    add('Request Validation','Empty JSON object body','Negative',{body:{}},'400 Bad Request','Validation error listing required fields','High','Request');
    add('Request Validation','No request body','Negative',{body:''},'400 Bad Request','Body required error','High','Request');
    add('Request Validation','Malformed JSON','Negative',{body:'{"name": "abc", '},'400 Bad Request','JSON parse error','High','Request');
    add('Request Validation','Unknown extra field','Negative',{body:{...req,unexpectedField:'x'}},'200 / 400','Ignored or rejected, never persisted blindly','Low','Request');
    add('Security','Mass-assignment (isAdmin/role)','Negative',{body:{...req,isAdmin:true,role:'admin'}},'400 / 403 / ignored','Privileged fields not applied','Medium','Request');
    if(method==='PUT') add('Request Validation','Partial payload on PUT','Negative',{body:Object.fromEntries(Object.entries(req).slice(0,1))},'400 Bad Request','Missing fields rejected','Medium','Request');
    for(const l of leaves(req)){
      const p=l.path.join('.'), t=typeOf(l.value);
      if(method!=='PATCH') add('Required Field',`Missing "${p}"`,'Negative',{body:setAt(req,l.path,null,true)},'400 Bad Request',`Error says "${p}" is required`,'High','Request');
      add('Null Value',`"${p}" is null`,'Negative',{body:setAt(req,l.path,null)},'400 Bad Request',`"${p}" rejected as null`,'Medium','Request');
      add('Data Type',`"${p}" wrong type (expected ${t})`,'Negative',{body:setAt(req,l.path,wrongValue(l.value))},'400 Bad Request',`Type error on "${p}"`,'Medium','Request');
      if(t==='string'){
        add('Boundary',`"${p}" empty string`,'Negative',{body:setAt(req,l.path,'')},'400 Bad Request',`"${p}" must not be empty`,'Medium','Request');
        add('Boundary',`"${p}" very long (5000 chars)`,'Negative',{body:setAt(req,l.path,'a'.repeat(5000))},'400 / 413','Max length enforced','Low','Request');
        add('Security',`"${p}" SQL injection`,'Negative',{body:setAt(req,l.path,"' OR '1'='1'; DROP TABLE users;--")},'400 Bad Request','Sanitised; no 5xx or data leak','High','Request');
        add('Security',`"${p}" XSS payload`,'Negative',{body:setAt(req,l.path,'<script>alert(1)</script>')},'400 / 200 (escaped)','Stored escaped or rejected','Medium','Request');
        add('Boundary',`"${p}" unicode & special chars`,'Positive',{body:setAt(req,l.path,'Tést ✓ 名前 !@#$%')},okStatus,'UTF-8 preserved','Low','Request');
        if(/email/i.test(p)){
          add('Format',`"${p}" invalid email`,'Negative',{body:setAt(req,l.path,'not-an-email')},'400 Bad Request','Email format error','High','Request');
          if(method==='POST') add('Business Rule',`Duplicate "${p}"`,'Negative',{body:req,note:'Send same payload twice'},'409 Conflict','Second request rejected','High','Request');
        }
        if(/(phone|mobile)/i.test(p)) add('Format',`"${p}" invalid phone`,'Negative',{body:setAt(req,l.path,'abc-123')},'400 Bad Request','Phone format error','Medium','Request');
        if(/(date|dob)/i.test(p)) add('Format',`"${p}" invalid date`,'Negative',{body:setAt(req,l.path,'31-31-2020')},'400 Bad Request','Date format error','Medium','Request');
        if(/pass/i.test(p)) add('Format',`"${p}" weak password`,'Negative',{body:setAt(req,l.path,'123')},'400 Bad Request','Password policy error','High','Request');
      }
      if(t==='number'){
        add('Boundary',`"${p}" negative`,'Negative',{body:setAt(req,l.path,-1)},'400 Bad Request','Range error','Medium','Request');
        add('Boundary',`"${p}" zero`,'Negative',{body:setAt(req,l.path,0)},'200 / 400','Matches documented range','Low','Request');
        add('Boundary',`"${p}" huge number`,'Negative',{body:setAt(req,l.path,9999999999999)},'400 Bad Request','Overflow / range error','Low','Request');
        add('Data Type',`"${p}" decimal`,'Negative',{body:setAt(req,l.path,1.5)},Number.isInteger(l.value)?'400 Bad Request':'200 OK',Number.isInteger(l.value)?'Integer expected':'Accepted','Low','Request');
      }
      if(t==='boolean') add('Data Type',`"${p}" as string "true"`,'Negative',{body:setAt(req,l.path,'true')},'400 Bad Request','Strict boolean expected','Low','Request');
    }
    for(const k of Object.keys(req)) if(Array.isArray(req[k])){
      add('Boundary',`Array "${k}" empty`,'Negative',{body:setAt(req,[k],[])},'200 / 400','Per spec','Low','Request');
      add('Data Type',`Array "${k}" wrong item types`,'Negative',{body:setAt(req,[k],[null,{}])},'400 Bad Request','Item type error','Low','Request');
    }
  } else if(hasBody){
    add('Request Validation','No request body','Negative',{body:''},'400 Bad Request','Body required','High','Request');
    add('Request Validation','Malformed JSON','Negative',{body:'{bad json'},'400 Bad Request','JSON parse error','High','Request');
  }

  /* ===== GENERAL ===== */
  add('Authentication','Missing Authorization header','Negative','No Authorization header','401 Unauthorized','Authentication required','High','General');
  add('Authentication','Invalid token','Negative','Bearer invalid.token.value','401 Unauthorized','Token rejected','High','General');
  add('Authentication','Expired token','Negative','Bearer <expired_token>','401 Unauthorized','Token expired error','High','General');
  add('Authorization','Valid token without permission','Negative','Bearer <low_privilege_token>','403 Forbidden','Access denied','Medium','General');
  if(hasBody){
    add('Headers','Content-Type text/plain','Negative','Content-Type: text/plain','415 Unsupported Media Type','Rejected','Medium','General');
    add('Headers','Missing Content-Type','Negative','No Content-Type','400 / 415','Rejected or safe default','Low','General');
    add('Performance','Oversized payload (>10MB)','Negative','Huge body','413 Payload Too Large','Rejected without crash','Low','General');
  }
  add('Headers','Accept: application/xml','Negative','Accept: application/xml','406 / 200 JSON','Handled gracefully','Low','General');
  const wrong=METHODS.find(m=>m!==method);
  add('HTTP Method',`Unsupported method (${wrong})`,'Negative',{note:`${wrong} ${endpoint}`},'405 Method Not Allowed','Allow header lists supported methods','Medium','General',{method:wrong});
  add('URL','Non-existent path','Negative',{note:'Append /nonexistent'},'404 Not Found','Not-found error','Medium','General',{endpoint:endpoint.replace(/\/$/,'')+'/nonexistent'});
  add('URL','Trailing slash','Positive',{note:'Add trailing slash'},'200 / 301','Same result or redirect','Low','General',{endpoint:endpoint.replace(/\/$/,'')+'/'});
  if(/^http:\/\//.test(endpoint)) add('Security','Plain HTTP endpoint','Negative','HTTP request','301 / refused','Redirect to HTTPS','Medium','General');
  if(pathParam){
    add('Path Param','Non-existent id','Negative',{note:'id = 999999999'},'404 Not Found','Not found error','High','General');
    add('Path Param','Invalid id format','Negative',{note:'id = abc'},'400 Bad Request','Invalid id error','Medium','General');
    add('Path Param','Negative id','Negative',{note:'id = -1'},'400 / 404','Rejected','Low','General');
    add('Path Param','SQL injection in id','Negative',{note:'id = 1 OR 1=1'},'400 / 404','No data leak or 5xx','High','General');
    add('Authorization',"Access another user's resource (IDOR)",'Negative',{note:'Token of user A, id of user B'},'403 / 404','Access denied','High','General');
  }
  if(method==='DELETE'){
    add('Idempotency','Delete same resource twice','Negative',{note:'Send DELETE twice'},'404 (2nd call)','No 5xx on second call','Medium','General');
    add('Functional','Resource gone after delete','Positive',{note:'DELETE then GET same id'},'404 Not Found','No longer retrievable','High','General');
  }
  if(method==='PUT') add('Idempotency','Repeat identical PUT','Positive',{body:req},'200 OK','Same result both times','Medium','General');
  if(method==='POST') add('Idempotency','Rapid double submit','Negative',{note:'Same POST twice quickly'},'201 then 409','No duplicate records','Medium','General');
  if(method==='PATCH') add('Functional','Only provided fields change','Positive',{body:req},'200 OK','Others unchanged','High','General');
  add('Performance','Response time under 2s','Positive','Valid request','≤ 2000 ms','Within SLA','Medium','General');
  add('Performance','10 concurrent requests','Positive','10 parallel requests','All 2xx','No errors / races','Low','General');
  add('Security','No sensitive data / stack traces leaked','Positive','Valid request','2xx','No passwords, tokens, traces','High','General');
  add('Security','Rate limiting (100 req / 1s)','Negative','Burst traffic','429 Too Many Requests','Throttled with Retry-After','Low','General');
  return list;
}
