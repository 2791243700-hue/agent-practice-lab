import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const api = read('openapi.json');
const events = read('events.schema.json');
const lesson = read('lesson.schema.json');
const schemas = api.components.schemas;
const standalone = value => JSON.parse(JSON.stringify(value).replaceAll('#/components/schemas/','#/$defs/'));
const ajv = new Ajv2020({strict:false,allErrors:true});
addFormats(ajv);
ajv.addFormat('password',true);
ajv.addFormat('binary',true);
await SwaggerParser.validate(structuredClone(api));

let checks = 0;
const validators = new Map();
for (const [name,schema] of Object.entries(schemas)) {
  const document = {$schema:'https://json-schema.org/draft/2020-12/schema',...standalone(schema),$defs:standalone(schemas)};
  assert(ajv.validateSchema(document), `${name}: invalid JSON Schema`);
  validators.set(name,ajv.compile(document));
  checks++;
}
const eventValidator = ajv.compile(events);
const lessonValidator = ajv.compile(lesson);
function valid(validator,value,label) {
  assert(validator(value),`${label}: ${ajv.errorsText(validator.errors,{separator:'; '})}`);
  checks++;
}
function invalid(name,value,label) {
  assert(!validators.get(name)(value), `Invalid input was accepted: ${label}`);
  checks++;
}

assert.deepEqual(events.oneOf,standalone(schemas.StoredEvent.oneOf));
for (const [name,definition] of Object.entries(events.$defs)) {
  assert.deepEqual(definition,standalone(schemas[name]),`Event schema drift: ${name}`);
}
for (const [name,definition] of Object.entries(lesson.$defs)) {
  assert.deepEqual(definition,standalone(schemas[name]),`Lesson schema drift: ${name}`);
}
checks+=2;

const operationIds = new Set();
for (const [route,methods] of Object.entries(api.paths)) {
  for (const [method,operation] of Object.entries(methods)) {
    assert(!operationIds.has(operation.operationId),'Duplicate operationId');
    operationIds.add(operation.operationId);
    const names = [...route.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
    assert.deepEqual((operation.parameters||[]).filter(p=>p.in==='path').map(p=>p.name).sort(),names.sort(),`Missing path parameter: ${route}`);
    if (['post','put','patch'].includes(method)) assert(operation.requestBody?.required,`Missing request body: ${operation.operationId}`);
    assert(operation.responses.default,`Missing error envelope: ${operation.operationId}`);
    checks++;
  }
}

const http = read('examples/http.json').examples;
for (const example of http) {
  assert(validators.has(example.schema),`Unknown example schema: ${example.schema}`);
  valid(validators.get(example.schema),example.value,example.name);
  if (example.schema === 'Submission') {
    const value = example.value;
    const required = value.rules.filter(r=>r.required);
    assert(required.length > 0,'Submission needs required rules');
    assert.equal(value.evaluation_passed,required.every(r=>r.passed));
    assert.equal(value.passed,value.mode==='live'&&value.evaluation_passed);
    const evidence = new Set(value.evidence.map(e=>e.id));
    for (const rule of value.rules) for (const id of rule.evidence_refs) assert(evidence.has(id),`Unresolved evidence: ${id}`);
  }
}

const scenarios = read('examples/events.json').scenarios;
const kinds = new Set();
for (const [name,sequence] of Object.entries(scenarios)) {
  const calls = new Map(), decisions = new Map();
  let terminal = false;
  for (const [index,event] of sequence.entries()) {
    valid(eventValidator,event,`${name} event ${index+1}`);
    assert(!terminal,`${name}: event after terminal state`);
    assert.equal(event.seq,index+1,`${name}: sequence gap`);
    assert.equal(event.run_id,sequence[0].run_id);
    assert.equal(event.attempt_id,sequence[0].attempt_id);
    assert.equal(event.mode,'demo','Mocks must be explicitly demo');
    kinds.add(event.kind);
    if(event.kind==='tool.requested') {
      const call=event.payload.call;
      assert(!calls.has(call.id),'Duplicate tool call');
      calls.set(call.id,{call,finished:false});
    }
    if(event.kind==='approval.requested'||event.kind==='approval.decided') {
      const approval=event.payload.approval, call=calls.get(approval.call_id)?.call;
      assert(call,'Approval must reference a requested tool');
      assert.equal(call.name,approval.tool_name);
      assert.deepEqual(call.arguments,approval.arguments);
      if(event.kind==='approval.requested') assert.equal(approval.status,'pending');
      else assert.notEqual(approval.status,'pending');
      decisions.set(approval.call_id,approval.status);
    }
    if(event.kind==='tool.completed') {
      const result=event.payload.result, entry=calls.get(result.call_id);
      assert(entry&&!entry.finished,'Tool result must match one unfinished call');
      assert.equal(entry.call.name,result.name);
      entry.finished=true;
      if(result.name==='save_todos'&&result.status==='ok') assert.equal(decisions.get(result.call_id),'approved');
      if(result.status==='denied') assert.equal(decisions.get(result.call_id),'denied');
    }
    terminal=['run.completed','run.failed','run.cancelled','run.interrupted'].includes(event.kind);
    if (event.kind==='run.completed') {
      assert([...calls.values()].every(entry=>entry.finished),'Successful run has unfinished tools');
      assert(![...decisions.values()].includes('pending'),'Successful run has pending approval');
    }
  }
  assert(terminal,`${name}: missing terminal event`);
}
assert.equal(kinds.size,schemas.StoredEvent.oneOf.length,'Examples must cover all event kinds');
valid(lessonValidator,read('examples/lesson-manifest.json'),'lesson manifest');

const sample = name => structuredClone(http.find(x=>x.name===name).value);
invalid('RunCreate',{...sample('start-demo-run'),owner_id:'someone-else'},'client supplied owner');
invalid('RunCreate',{...sample('start-demo-run'),input_text:''},'empty input');
invalid('RunCreate',{...sample('start-demo-run'),mode:'live'},'client supplied run mode');
invalid('ApprovalDecision',{decision:'approve',arguments:{items:[]}},'tampered approval arguments');
invalid('ApprovalDecision',{decision:'yes'},'unknown approval decision');
invalid('Approval',{...sample('awaiting-approval').pending_approval,status:'approved'},'approved without decision or timestamp');
invalid('ChoiceAnswers',{question_id:'q',option_id:'a',score:100},'client supplied score');
invalid('FactsAnswers',{facts:[{task_id:'t',due_date:'2026-99-99',source_id:'s'}]},'invalid date');
invalid('CourseAnswers',{course_id:'agent101',session_date:'2026-11-05'},'missing room');
invalid('Settings',{system_instruction:'',temperature:2},'out of range setting');
invalid('ModelProfile',{...sample('model-profile-no-key-returned'),api_key:'example-placeholder'},'key returned by profile API');
invalid('SaveTodosCall',{id:'call-test',name:'save_todos',arguments:{items:[]}},'empty todo list');
const badEvent=structuredClone(scenarios['cancelled'][1]);
badEvent.payload.status='completed';
assert(!eventValidator(badEvent),'Mismatched terminal payload accepted');checks++;
const badManifest=read('examples/lesson-manifest.json');badManifest.intro_file='../outside.md';
assert(!lessonValidator(badManifest),'Traversal path accepted');checks++;
badManifest.intro_file='/absolute.md';assert(!lessonValidator(badManifest),'Absolute path accepted');checks++;
badManifest.intro_file='intro.md';badManifest.rules=[];assert(!lessonValidator(badManifest),'Empty grading rules accepted');checks++;
const reflection = sample('reflection-answer');
invalid('ReflectionAnswers',{...reflection,passed:true},'client supplied reflection result');
invalid('ReflectionAnswers',{...reflection,judgment:'always-better'},'unknown reflection judgment');
invalid('ReflectionAnswers',{...reflection,explanation:'  \n'},'blank explanation input');
invalid('ReflectionAnswers',{...reflection,challenge:{...reflection.challenge,instruction:'  '}},'blank challenge instruction input');
const invalidCitation=structuredClone(reflection);invalidCitation.evidence.before.start_offset=-1;
invalid('ReflectionAnswers',invalidCitation,'negative quote offset');
invalid('ReflectionAnswers',{...reflection,challenge:{...reflection.challenge,judgments:[]}},'empty challenge judgments');
invalid('ReflectionForm',{kind:'reflection',prompt:'test',challenge:{id:'c',title:'t',notice:'n',items:[{id:'i',label:'l',correct:'known'}]}},'private answer in public challenge');
invalid('PutReflectionDraftRequest',{expected_revision:-1,expected_attempt_revision:1,draft:{}},'invalid draft revision');
for (const folder of fs.readdirSync(path.join(root,'../content/lessons'),{withFileTypes:true})) {
  if(folder.isDirectory()) valid(lessonValidator,JSON.parse(fs.readFileSync(path.join(root,'../content/lessons',folder.name,'manifest.json'),'utf8')),`published lesson ${folder.name}`);
}
console.log(`Contract validation passed: ${operationIds.size} operations, ${validators.size} schemas, ${http.length} HTTP examples, ${Object.keys(scenarios).length} event scenarios / ${kinds.size} kinds; ${checks} structural checks.`);
console.log('This validates contracts and fixtures only; no server, concurrency behavior, or live model was tested.');
