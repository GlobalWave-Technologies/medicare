import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, createWriteStream, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import pg from 'pg';
import assert from 'node:assert/strict';
const root=process.cwd(), bin='C:/Program Files/PostgreSQL/18/bin';
const dbName='medicare_test_release', restored='medicare_test_restored';
const url=name=>`postgresql://qa_admin@127.0.0.1:16449/${name}`;
const runtime=name=>`postgresql://medicare_runtime@127.0.0.1:16449/${name}`;
const at=minutes=>new Date(Date.now()+minutes*60000).toISOString();
const password='Synthetic release acceptance 2026!';
const origin='https://release.example.test', children=[], checks=[];
const check=(name,condition=true)=>{assert.ok(condition,name); checks.push(name); console.log('PASS '+name);};
const sql=new pg.Client({connectionString:url(dbName)}); await sql.connect();
const run=(exe,args,env={})=>{const r=spawnSync(exe,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',windowsHide:true}); if(r.status!==0)throw Error(`${exe} failed: ${r.stderr?.slice(-1000)} ${r.stdout?.slice(-1000)}`);return r.stdout;};
const migration=()=>run(process.execPath,['../node_modules/prisma/build/index.js','migrate','deploy','--config','prisma.config.ts'],{});
for(let i=0;i<2;i++) { const r=spawnSync(process.execPath,['../node_modules/prisma/build/index.js','migrate','deploy'],{cwd:join(root,'server'),env:{...process.env,DATABASE_URL:url(dbName)},encoding:'utf8',windowsHide:true}); assert.equal(r.status,0,r.stderr); writeFileSync(`.release-migration-${i}.log`,r.stdout+r.stderr); }
check('eight migrations deployed twice',(await sql.query('SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n===8);
await sql.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='medicare_runtime') THEN CREATE ROLE medicare_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$");
const grant=async(c)=>{await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO medicare_runtime; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO medicare_runtime; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medicare_runtime; REVOKE ALL ON _prisma_migrations FROM medicare_runtime; REVOKE UPDATE ON "AuditEvent", "EncounterAmendment" FROM medicare_runtime; GRANT DELETE ON "EncounterComplaint", "Diagnosis" TO medicare_runtime;');};
await grant(sql);
const {getPrisma,disconnectDatabase}=await import('./server/dist/database/prisma.js');
const {bootstrapAdmin}=await import('./server/dist/modules/staff/bootstrapAdmin.js');
await bootstrapAdmin(getPrisma({DATABASE_URL:url(dbName)}),{firstName:'Release',lastName:'Administrator',email:'admin@release.test',staffNumber:'STF-RELADMIN',password}); await disconnectDatabase();
async function start(port,name,mode='production',clientOrigin=origin) {
 const log=createWriteStream(`.release-api-${port}.log`);const child=spawn(process.execPath,['server/dist/server.js'],{cwd:root,env:{...process.env,NODE_ENV:mode,PORT:String(port),DATABASE_URL:runtime(name),CLIENT_ORIGIN:clientOrigin,LOG_LEVEL:'info',TRUSTED_PROXY_CIDRS:''},windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.pipe(log);child.stderr.pipe(log);
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}throw Error('Server did not become ready');
}
function client(port=17420,clientOrigin=origin){return {port,origin:clientOrigin,cookie:'',csrf:''};}
async function api(c,method,path,body,status=200,csrf=c.csrf){
 const res=await fetch(`http://127.0.0.1:${c.port}/api/v1${path}`,{method,headers:{Origin:c.origin,...(c.cookie?{Cookie:c.cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const value=await res.json();assert.equal(res.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return {data:value.data,header:res.headers,error:value.error};
}
async function login(c,email){const r=await api(c,'POST','/auth/login',{email,password});const cookie=r.header.get('set-cookie');c.cookie=cookie.split(';')[0];c.csrf=(await api(c,'GET','/auth/csrf')).data.csrfToken;return cookie;}
try {
 await start(17420,dbName);check('production built API ready under restricted runtime role');
 const admin=client();const cookie=await login(admin,'admin@release.test');check('production cookie Secure HttpOnly SameSite Strict',/Secure/.test(cookie)&&/HttpOnly/.test(cookie)&&/SameSite=Strict/.test(cookie));
 check('zero patients',(await api(admin,'GET','/patients')).data.items.length===0);check('zero appointments',(await api(admin,'GET','/appointments')).data.items.length===0);
 const staff={};for(const [key,role] of [['records','RECORDS_OFFICER'],['doctor','DOCTOR_IN_CHARGE'],['other','DOCTOR_IN_CHARGE']]) {const s=(await api(admin,'POST','/staff',{firstName:key==='doctor'?'Alexandria-Cassandra':'Release',lastName:key==='doctor'?'Synthetic Clinician With A Long Display Name':key,email:`${key}@release.test`,staffNumber:`STF-REL${key.toUpperCase()}`,password,role},201)).data.user;staff[key]=s;}
 const records=client(),doctor=client(),other=client();await login(records,'records@release.test');await login(doctor,'doctor@release.test');await login(other,'other@release.test');
 check('zero medical records',(await api(doctor,'GET','/encounters')).data.items.length===0);
 for(const c of [admin,records]){await api(c,'GET','/encounters',undefined,403);await api(c,'GET','/auth/me');}check('admin and records clinical denial preserves session');
 const patientBody={firstName:'Alexandria-Cassandra',middleName:'Synthetic Release Acceptance',lastName:'Montgomery-Wellington Long Name',dateOfBirth:'1980-02-03',phone:'+15550102030'};
 await api(records,'POST','/patients',patientBody,403,'0'.repeat(64));check('patient bad CSRF no write',(await api(admin,'GET','/patients')).data.items.length===0);
 const patient=(await api(records,'POST','/patients',patientBody,201)).data.patient;await api(admin,'POST','/patients',patientBody,409);check('patient valid retry and duplicate rejection');
 await api(records,'PATCH',`/patients/${patient.id}`,{middleName:'First external edit'});await api(admin,'PATCH',`/patients/${patient.id}`,{middleName:'Synthetic Release Acceptance'});check('patient same-field last-write semantics',(await api(records,'GET',`/patients/${patient.id}`)).data.patient.middleName==='Synthetic Release Acceptance');
 await api(records,'POST',`/patients/${patient.id}/archive`,{});check('archived filter',(await api(admin,'GET','/patients?archived=true')).data.items.length===1);await api(records,'POST',`/patients/${patient.id}/reactivate`,{});
 for(let i=0;i<21;i++)await api(admin,'POST','/patients',{firstName:'Synthetic',lastName:`Pagination ${String(i).padStart(2,'0')}`},201);
 check('patient pagination',(await api(records,'GET','/patients?page=2&limit=20')).data.items.length===2);check('zero search',(await api(admin,'GET','/patients?search=NoSuchReleasePerson')).data.items.length===0);
 const apptBody={patientId:patient.id,clinicianId:staff.doctor.id,scheduledStart:at(10),scheduledEnd:at(40),type:'CONSULTATION',reason:'Synthetic acceptance appointment. '.repeat(12)};
 await api(records,'POST','/appointments',apptBody,403,'0'.repeat(64));check('appointment bad CSRF no write',(await api(admin,'GET','/appointments')).data.items.length===0);
 const appt=(await api(records,'POST','/appointments',apptBody,201)).data.appointment;await api(admin,'POST','/appointments',apptBody,409);check('appointment conflict protection');
 await api(records,'PATCH',`/appointments/${appt.id}`,{scheduledStart:at(20),scheduledEnd:at(50)});await api(admin,'PATCH',`/appointments/${appt.id}/status`,{status:'CONFIRMED'});await api(doctor,'PATCH',`/appointments/${appt.id}/status`,{status:'CHECKED_IN'});
 await api(records,'PATCH',`/appointments/${appt.id}/status`,{status:'CONFIRMED'},409);check('stale incompatible appointment status rejected');
 await api(other,'GET',`/appointments/${appt.id}`,undefined,404);await api(doctor,'POST','/appointments',apptBody,403);await api(doctor,'POST',`/appointments/${appt.id}/cancel`,{},403);check('doctor own appointment scope and booking cancellation restrictions');
 const cancel=(await api(admin,'POST','/appointments',{...apptBody,scheduledStart:at(1440),scheduledEnd:at(1470)},201)).data.appointment;await api(records,'POST',`/appointments/${cancel.id}/cancel`,{reason:'Synthetic cancellation history retained'});check('cancellation retained',(await api(admin,'GET',`/appointments/${cancel.id}`)).data.appointment.status==='CANCELLED');
 const clinical={patientId:patient.id,appointmentId:appt.id,historySummary:'Fictional history for release testing only. '.repeat(90),clinicalNotes:'Fictional clinical observations; not medical guidance. '.repeat(90),treatmentPlan:'Synthetic documented plan. '.repeat(45),complaints:[{description:'Synthetic complaint one'},{description:'Synthetic complaint two'}],diagnoses:[{description:'Synthetic diagnosis one',code:'TEST1'},{description:'Synthetic diagnosis two',code:'TEST2'}]};
 await api(doctor,'POST','/encounters',clinical,403,'0'.repeat(64));check('clinical bad CSRF no write',(await api(doctor,'GET','/encounters')).data.items.length===0);
 const enc=(await api(doctor,'POST','/encounters',clinical,201)).data.encounter;
 await api(doctor,'PATCH',`/encounters/${enc.id}`,{roomLabel:'External draft edit'});await api(doctor,'PATCH',`/encounters/${enc.id}`,{roomLabel:'Stale author last write'});check('draft same-field last-write semantics',(await api(doctor,'GET',`/encounters/${enc.id}`)).data.encounter.roomLabel==='Stale author last write');
 const final=(await api(doctor,'POST',`/encounters/${enc.id}/finalize`,{})).data.encounter;await api(doctor,'PATCH',`/encounters/${enc.id}`,{clinicalNotes:'must not overwrite'},409);await api(other,'POST',`/encounters/${enc.id}/amend`,{reason:'Forbidden',content:'Forbidden'},403);
 for(let i=1;i<=2;i++)await api(doctor,'POST',`/encounters/${enc.id}/amend`,{reason:`Synthetic amendment ${i}`,content:`Separate synthetic correction ${i}. `.repeat(30)},201);
 const amended=(await api(doctor,'GET',`/encounters/${enc.id}`)).data.encounter;check('final original immutable with two independent amendments',amended.clinicalNotes===final.clinicalNotes&&amended.amendments.length===2);check('patient clinical history',(await api(doctor,'GET',`/patients/${patient.id}/encounters`)).data.items.length===1);
 await api(admin,'DELETE',`/staff/${staff.records.id}/sessions`);await api(records,'POST','/patients',{firstName:'Revoked',lastName:'Must not save'},401);check('revoked session rejects mutation',(await api(admin,'GET','/patients?search=Revoked')).data.items.length===0);
 const foreign=client();foreign.origin='https://wrong.example.test';await api(foreign,'GET','/health',undefined,403);check('foreign origin rejected');
 const privileged=await sql.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='medicare_runtime'");check('runtime not superuser database creator or role creator',Object.values(privileged.rows[0]).every(v=>v===false));
 const runtimeSql=new pg.Client({connectionString:runtime(dbName)});await runtimeSql.connect();for(const statement of ['UPDATE "AuditEvent" SET metadata=metadata','DELETE FROM "EncounterAmendment"','TRUNCATE "AuditEvent"','CREATE TABLE release_forbidden(id int)']){let denied=false;try{await runtimeSql.query(statement);}catch{denied=true;}check('runtime denied '+statement.split(' ').slice(0,3).join(' '),denied);}await runtimeSql.end();
 const tables=['StaffUser','Patient','Appointment','Encounter','EncounterComplaint','Diagnosis','EncounterAmendment','AuditEvent'];
 const digest=async(c)=>Object.fromEntries(await Promise.all(tables.map(async table=>{const rows=(await c.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;return[table,{rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}];})));
 const before=await digest(sql), backup=join(readFileSync('.release-qa-path','utf8').trim(),'release.dump');
 run(join(bin,'pg_dump.exe'),['-h','127.0.0.1','-p','16449','-U','qa_admin','-Fc','-f',backup,dbName]);check('pg_dump custom format completed');
 run(join(bin,'createdb.exe'),['-h','127.0.0.1','-p','16449','-U','qa_admin',restored]);run(join(bin,'pg_restore.exe'),['-h','127.0.0.1','-p','16449','-U','qa_admin','--no-owner','--no-acl','--single-transaction','-d',restored,backup]);
 const restoredSql=new pg.Client({connectionString:url(restored)});await restoredSql.connect();assert.deepEqual(await digest(restoredSql),before);check('restore exact row digests for eight representative tables');await grant(restoredSql);await restoredSql.end();
 await start(17422,restored);const restoredDoctor=client(17422);await login(restoredDoctor,'doctor@release.test');check('restored built application returns final record and amendments',(await api(restoredDoctor,'GET',`/encounters/${enc.id}`)).data.encounter.amendments.length===2);
 await start(17421,dbName,'test','http://127.0.0.1:17527');
 const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};
 const gateway=createServer((req,res)=>{
  if(req.url.startsWith('/api/')){let fault={};try{fault=JSON.parse(readFileSync('.release-fault.json','utf8'));}catch{}const match=fault.path&&req.url.includes(fault.path)&&(!fault.method||req.method===fault.method);if(match)writeFileSync('.release-fault.json','{}');
   const perform=()=>{if(match&&fault.mode==='unavailable'){res.writeHead(503,{'Content-Type':'application/json','X-Request-Id':'release-simulated-503'});return res.end(JSON.stringify({success:false,error:{code:'SERVICE_UNAVAILABLE',message:'Service unavailable',requestId:'release-simulated-503'}}));}if(match&&fault.mode==='drop-read')return req.socket.destroy();
    const headers={...req.headers,host:'127.0.0.1:17421'};if(match&&fault.mode==='csrf')headers['x-csrf-token']='0'.repeat(64);
    const proxy=request({hostname:'127.0.0.1',port:17421,path:req.url,method:req.method,headers},response=>{if(match&&fault.mode==='drop-mutation'){response.resume();response.on('end',()=>req.socket.destroy());return;}res.writeHead(response.statusCode,response.headers);response.pipe(res);});proxy.on('error',()=>{res.writeHead(503);res.end();});req.pipe(proxy);};if(match&&fault.mode==='delay')setTimeout(perform,2500);else perform();return;
  }
  const path=resolve(root,'client/dist','.'+decodeURIComponent(req.url.split('?')[0]));if(!path.startsWith(resolve(root,'client/dist')+'\\')&&path!==resolve(root,'client/dist')){res.writeHead(404);res.end();return;}
  let file=path; if(!existsSync(file)||!file.split(/[\\/]/).pop().includes('.'))file=resolve(root,'client/dist/index.html');try{res.writeHead(200,{'Content-Type':mime['.'+file.split('.').pop()]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
 });gateway.listen(17527,'127.0.0.1');
 writeFileSync('.release-ready.json',JSON.stringify({patientId:patient.id,encounterId:enc.id,appointmentId:appt.id,staff,checks,backupTables:before},null,2));
 writeFileSync('.release-processes.json',JSON.stringify(children.map(c=>c.pid)));console.log('BROWSER READY http://127.0.0.1:17527');
 process.on('SIGTERM',()=>{gateway.close();children.forEach(c=>c.kill());process.exit();});
 await new Promise(()=>{});
}catch(error){console.error(error);children.forEach(c=>c.kill());process.exitCode=1;await sql.end();}
