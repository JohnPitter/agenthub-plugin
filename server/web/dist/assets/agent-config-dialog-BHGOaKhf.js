import{u as _,r,e as c,j as e,a8 as p,X as q,a9 as y,g as d,o as B,B as I,aa as W}from"./index-BcdNi25W.js";import{a as G,g as T}from"./models-BUP5M2kj.js";import{C as H}from"./chevron-up-XuC41_c_.js";const J={architect:`# Soul: Architect

## Personality
You are methodical, analytical, and deeply thoughtful. You approach every problem like building a cathedral — with patience, precision, and long-term vision.

## Values
- **Clarity over cleverness** — Simple designs that everyone understands beat complex ones only you can maintain
- **Trade-off documentation** — Every decision has costs; you always document what you're trading away
- **Big O awareness** — Performance implications are always top of mind
- **Separation of concerns** — Clean boundaries between modules are non-negotiable

## Style
- You think in systems, not features
- You draw diagrams in your head before writing a single line
- You ask "what happens at 10x scale?" before approving a design
- You prefer composition over inheritance, interfaces over implementations
- Your plans are specific enough that a dev can implement without guessing`,tech_lead:`# Soul: Tech Lead

## Personality
You are pragmatic, results-oriented, and a natural communicator. You bridge the gap between vision and execution, keeping the team unblocked and moving forward.

## Values
- **Ship it** — Perfect is the enemy of good; progress beats perfection
- **Unblock others** — Your #1 job is ensuring no one is stuck
- **Context sharing** — Over-communicate rather than under-communicate
- **Prioritization** — Not everything is urgent; you ruthlessly prioritize

## Style
- You break big problems into small, actionable tasks
- You match tasks to the right person based on skill and availability
- You check in on progress proactively
- You escalate blockers fast and propose solutions alongside them
- You keep status updates concise and informative`,frontend_dev:`# Soul: Frontend Developer

## Personality
You are creative, detail-oriented, and obsessed with user experience. Every pixel matters. Every interaction should feel smooth and intentional.

## Values
- **User empathy** — You always think from the user's perspective
- **Accessibility** — If it's not accessible, it's not done
- **Performance** — Perceived speed matters; lazy load, debounce, optimize rendering
- **Consistency** — Follow the design system religiously

## Style
- You prototype quickly and iterate based on feedback
- You test on multiple screen sizes before calling something done
- You use semantic HTML and ARIA attributes naturally
- You keep components small, focused, and composable
- Your CSS is utility-first (Tailwind) and avoids custom overrides when possible`,backend_dev:`# Soul: Backend Developer

## Personality
You are security-first, thorough, and robustness-obsessed. You assume every input is malicious and every network call will fail. You build for the worst case.

## Values
- **Security by default** — Validate everything, trust nothing from outside
- **Idempotency** — Operations should be safe to retry
- **Observability** — If you can't measure it, you can't manage it
- **Data integrity** — The database is the source of truth; protect it

## Style
- You validate inputs at system boundaries
- You handle errors explicitly, never silently swallowing them
- You write queries with indexes in mind
- You log enough context to debug issues in production
- You prefer transactions for multi-step operations`,qa:`# Soul: QA Engineer

## Personality
You are an investigator — skeptical, curious, and relentless. You don't just check if things work; you actively try to break them. A healthy dose of paranoia keeps the codebase honest.

## Values
- **Reproduce before reporting** — Every bug report includes steps to reproduce
- **Edge cases first** — The happy path works; what about the sad path?
- **Regression prevention** — Every bug fix gets a test to prevent recurrence
- **Security mindset** — Think like an attacker, protect like a guardian

## Style
- You write tests that cover boundary conditions, not just happy paths
- You check for type safety, null handling, and error scenarios
- You verify against requirements, not just implementation
- You provide actionable feedback with specific file and line references
- You distinguish between critical issues and nice-to-haves`,receptionist:`# Soul: Team Lead

## Personality
You are warm, professional, and direct. You're the Scrum Master of the team — coordinating work, managing the backlog, and interacting with stakeholders via WhatsApp. You speak Brazilian Portuguese naturally.

## Values
- **Acolhimento** — Make every user feel heard and welcome
- **Concisão** — Respond in 2-3 sentences maximum
- **Triagem inteligente** — Know when to handle directly vs escalate to the dev team
- **Honestidade** — Never make up technical information; say you'll check with the team

## Style
- You respond quickly and concisely
- You detect technical requests (bugs, features, deployments) and escalate them
- For casual conversation or status questions, you respond directly
- You never hallucinate technical details — you redirect to the team when unsure`,doc_writer:`# Soul: Doc Writer

## Personality
You are meticulous, organized, and clarity-obsessed. You believe great documentation is as important as great code. You turn complex systems into understandable references.

## Values
- **Accuracy** — Every documented endpoint, parameter, and example must match the actual code
- **Completeness** — Cover all endpoints, all parameters, all edge cases
- **Readability** — Use clear language, consistent formatting, and helpful examples
- **Freshness** — Documentation should always reflect the current state of the codebase

## Style
- You analyze code statically to extract API documentation
- You generate structured, machine-readable endpoint definitions
- You summarize changes in clear, concise markdown
- You keep docs organized by domain/group for easy navigation`,support:`# Soul: Support Engineer

## Personality
You are a senior DevOps/SRE specialist — calm under pressure, systematic, and thorough.
You have full access to the machine and you use it responsibly.

## Values
- **Root cause analysis** — Fix the underlying issue, not just the symptom
- **Minimal blast radius** — Make the smallest change that resolves the problem
- **Document what you did** — Always explain the fix for the team lead
- **Escalate when uncertain** — If the fix could break something, flag it

## Style
- You diagnose before acting: read logs, check system state, trace the error
- You always report back to the team lead with a clear summary
- You clean up after yourself — no temp files, no dangling processes
- You treat elevated access as a responsibility, not a shortcut`,custom:`# Soul: Custom Agent

## Personality
You are adaptable, focused, and precise. You follow instructions carefully while applying good engineering judgment.

## Values
- **Follow instructions** — Do exactly what's asked, no more, no less
- **Ask when unsure** — Better to clarify than to guess wrong
- **Quality** — Even simple tasks deserve clean execution

## Style
- You read requirements carefully before starting
- You complete tasks thoroughly and report results clearly`},Q=["default","acceptEdits","bypassPermissions"],K=["junior","pleno","senior","especialista","arquiteto"],X=["Read","Glob","Grep","Bash","Write","Edit","Task","WebSearch","WebFetch"];function ae({agent:s,onSave:E,onClose:u}){const{t:n}=_(),[g,C]=r.useState([]);r.useEffect(()=>{c("/plans/models").then(t=>{var a;(a=t.models)!=null&&a.length&&C(t.models)}).catch(()=>{})},[]);const P=typeof s.allowedTools=="string"?JSON.parse(s.allowedTools):s.allowedTools??[],[m,O]=r.useState(s.model),[l,k]=r.useState(s.maxThinkingTokens??0),[w,z]=r.useState(P),[j,M]=r.useState(s.systemPrompt??""),[x,D]=r.useState(s.permissionMode??"default"),[N,L]=r.useState(s.level??"senior"),[i,b]=r.useState(s.avatar??""),[h,V]=r.useState(!1),[S,Y]=r.useState(s.soul??""),[A,R]=r.useState([]),[f,v]=r.useState(new Set);r.useEffect(()=>{c("/skills").then(t=>R(t.skills)).catch(()=>{}),c(`/agents/${s.id}/skills`).then(t=>{v(new Set(t.skills.map(a=>a.id)))}).catch(()=>{})},[s.id]);const $=async t=>{try{f.has(t)?(await c(`/agents/${s.id}/skills/${t}`,{method:"DELETE"}),v(a=>{const o=new Set(a);return o.delete(t),o})):(await c(`/agents/${s.id}/skills`,{method:"POST",body:JSON.stringify({skillId:t})}),v(a=>new Set(a).add(t)))}catch{}},F=t=>{z(a=>a.includes(t)?a.filter(o=>o!==t):[...a,t])},U=async()=>{await E(s.id,{model:m,level:N,avatar:i||void 0,maxThinkingTokens:l>0?l:null,allowedTools:w,systemPrompt:j.trim()||void 0,permissionMode:x,soul:S.trim()||null}),u()};return e.jsx("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/40",onClick:u,children:e.jsxs("div",{className:"w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-neutral-bg1 p-6 shadow-16 animate-fade-up",onClick:t=>t.stopPropagation(),children:[e.jsxs("div",{className:"flex items-center justify-between mb-6",children:[e.jsxs("div",{className:"flex items-center gap-3",children:[p(i)?e.jsx("img",{src:p(i,40),alt:s.name,className:"h-10 w-10 rounded-md bg-neutral-bg2"}):e.jsx("div",{className:"flex h-10 w-10 items-center justify-center rounded-md text-[14px] font-semibold text-white",style:{backgroundColor:s.color??"#6366F1"},children:s.name.charAt(0)}),e.jsxs("div",{children:[e.jsx("h2",{className:"text-[18px] font-semibold text-neutral-fg1",children:s.name}),e.jsx("p",{className:"text-[12px] text-neutral-fg3",children:s.role})]})]}),e.jsx("button",{onClick:u,className:"rounded-md p-2 text-neutral-fg3 transition-colors hover:bg-neutral-bg-hover hover:text-neutral-fg1",children:e.jsx(q,{className:"h-5 w-5"})})]}),e.jsxs("div",{className:"flex flex-col gap-5",children:[e.jsxs("div",{children:[e.jsx("label",{className:"mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("settings.avatar")}),e.jsx("div",{className:"grid grid-cols-8 gap-2",children:y[0].avatars.map(t=>{const a=i===t.value;return e.jsxs("button",{type:"button",onClick:()=>b(a?"":t.value),className:d("flex flex-col items-center gap-1 rounded-lg p-1.5 transition-all",a?"bg-brand-light ring-2 ring-brand":"hover:bg-neutral-bg-hover"),title:t.label,children:[e.jsx("img",{src:p(t.value,48),alt:t.label,className:"h-10 w-10 rounded-md",loading:"lazy"}),e.jsx("span",{className:"text-[9px] font-medium text-neutral-fg3 truncate w-full text-center",children:t.label})]},t.value)})}),e.jsxs("button",{type:"button",onClick:()=>V(!h),className:"mt-2 flex items-center gap-1.5 text-[11px] font-medium text-brand hover:text-brand-hover transition-colors",children:[h?n("settings.lessAvatars"):`${n("settings.moreAvatars")} (${y.reduce((t,a)=>t+a.avatars.length,0)})`,h?e.jsx(H,{className:"h-3.5 w-3.5"}):e.jsx(B,{className:"h-3.5 w-3.5"})]}),h&&e.jsx("div",{className:"mt-2 space-y-4 rounded-lg border border-stroke bg-neutral-bg2 p-4 animate-fade-up",children:y.slice(1).map(t=>e.jsxs("div",{children:[e.jsx("p",{className:"mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-fg3",children:t.category}),e.jsx("div",{className:"grid grid-cols-8 gap-2",children:t.avatars.map(a=>{const o=i===a.value;return e.jsxs("button",{type:"button",onClick:()=>b(o?"":a.value),className:d("flex flex-col items-center gap-1 rounded-lg p-1.5 transition-all",o?"bg-brand-light ring-2 ring-brand":"hover:bg-neutral-bg-hover"),title:a.label,children:[e.jsx("img",{src:p(a.value,48),alt:a.label,className:"h-10 w-10 rounded-md",loading:"lazy"}),e.jsx("span",{className:"text-[9px] font-medium text-neutral-fg3 truncate w-full text-center",children:a.label})]},a.value)})})]},t.category))}),i&&e.jsx("button",{type:"button",onClick:()=>b(""),className:"mt-2 text-[11px] font-medium text-danger hover:underline",children:n("settings.removeAvatar")})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.model")}),e.jsx("select",{value:m,onChange:t=>O(t.target.value),className:"w-full rounded-md border border-stroke bg-neutral-bg2 px-4 py-3 text-[14px] text-neutral-fg1 outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand-light",children:g.length>0?Object.entries(g.reduce((t,a)=>{const o=G(a.id);return t[o]||(t[o]=[]),t[o].push(a),t},{})).map(([t,a])=>e.jsx("optgroup",{label:t,children:a.map(o=>e.jsx("option",{value:o.id,children:T(o.id)},o.id))},t)):e.jsx("option",{value:m,children:T(m)})}),g.length===0&&e.jsx("p",{className:"mt-1.5 text-[11px] text-neutral-fg3",children:"Modelos configurados pelo admin via OpenRouter"})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.permissions")}),e.jsx("select",{value:x,onChange:t=>D(t.target.value),className:"w-full rounded-md border border-stroke bg-neutral-bg2 px-4 py-3 text-[14px] text-neutral-fg1 outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand-light",children:Q.map(t=>e.jsx("option",{value:t,children:n(`permissions.${t}`)},t))}),e.jsx("p",{className:"mt-1.5 text-[11px] text-neutral-fg3",children:n(`permissions.${x}Desc`)})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.level")}),e.jsx("select",{value:N,onChange:t=>L(t.target.value),className:"w-full rounded-md border border-stroke bg-neutral-bg2 px-4 py-3 text-[14px] text-neutral-fg1 outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand-light",children:K.map(t=>e.jsx("option",{value:t,children:n(`levels.${t}`)},t))})]}),e.jsxs("div",{className:"rounded-lg border border-stroke bg-neutral-bg2 p-4",children:[e.jsxs("div",{className:"flex items-center justify-between mb-1",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(I,{className:"h-4 w-4 text-purple"}),e.jsx("label",{className:"text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:"Extended Thinking"})]}),e.jsx("button",{type:"button",onClick:()=>k(l>0?0:32e3),className:d("relative h-5 w-9 rounded-full transition-all duration-200",l>0?"bg-gradient-to-r from-brand to-purple shadow-brand":"bg-stroke"),children:e.jsx("span",{className:d("absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",l>0&&"left-[18px]")})})]}),e.jsx("p",{className:"text-[11px] text-neutral-fg3 mb-3",children:n("agents.thinkingTokens")}),l>0&&e.jsxs("div",{className:"pt-3 border-t border-stroke",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("span",{className:"text-[11px] text-neutral-fg3",children:"Budget de tokens"}),e.jsxs("span",{className:"text-[12px] font-semibold text-purple tabular-nums",children:[(l/1e3).toFixed(0),"k"]})]}),e.jsx("div",{className:"grid grid-cols-4 gap-2",children:[32e3,64e3,128e3,256e3].map(t=>e.jsxs("button",{type:"button",onClick:()=>k(t),className:d("rounded-lg py-2 text-[12px] font-semibold transition-all",l===t?"bg-purple text-white shadow-brand":"bg-neutral-bg3 text-neutral-fg2 hover:bg-neutral-bg-hover hover:text-neutral-fg1"),children:[t/1e3,"k"]},t))})]})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-2 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.tools")}),e.jsx("div",{className:"flex flex-wrap gap-2",children:X.map(t=>{const a=w.includes(t);return e.jsx("button",{onClick:()=>F(t),className:`rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${a?"bg-brand text-white":"bg-neutral-bg2 text-neutral-fg3 hover:bg-stroke2 hover:text-neutral-fg2"}`,children:t},t)})})]}),e.jsxs("div",{children:[e.jsxs("label",{className:"mb-2 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:[n("skills.title")," (",f.size,")"]}),A.filter(t=>t.isActive).length>0?e.jsx("div",{className:"flex flex-wrap gap-2",children:A.filter(t=>t.isActive).map(t=>{const a=f.has(t.id);return e.jsx("button",{onClick:()=>$(t.id),className:`rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${a?"bg-brand text-white":"bg-neutral-bg2 text-neutral-fg3 hover:bg-stroke2 hover:text-neutral-fg2"}`,title:t.description??void 0,children:t.name},t.id)})}):e.jsx("p",{className:"text-[12px] text-neutral-fg3 italic",children:n("skills.noSkillsAvailable")})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center justify-between mb-1.5",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(W,{className:"h-4 w-4 text-purple"}),e.jsx("label",{className:"text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.soul")})]}),e.jsx("button",{type:"button",onClick:()=>Y(J[s.role]??""),className:"text-[11px] font-medium text-brand hover:text-brand-hover transition-colors",children:"Usar template"})]}),e.jsx("p",{className:"mb-2 text-[11px] text-neutral-fg3",children:"Define a personalidade, valores e estilo do agente. Injetado antes do prompt base."}),e.jsx("textarea",{value:S,onChange:t=>Y(t.target.value),placeholder:`# Soul: Agent Name

## Personality
...

## Values
...

## Style
...`,rows:6,className:"w-full resize-none rounded-md border border-stroke bg-neutral-bg2 px-4 py-3 text-[13px] text-neutral-fg1 placeholder-neutral-fg-disabled font-mono outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand-light"})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-neutral-fg2",children:n("agents.systemPrompt")}),e.jsx("textarea",{value:j,onChange:t=>M(t.target.value),placeholder:"Instrucoes adicionais para o agent...",rows:4,className:"w-full resize-none rounded-md border border-stroke bg-neutral-bg2 px-4 py-3 text-[13px] text-neutral-fg1 placeholder-neutral-fg-disabled font-mono outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand-light"})]}),e.jsxs("div",{className:"flex justify-end gap-3",children:[e.jsx("button",{onClick:u,className:"rounded-md px-5 py-2.5 text-[14px] font-medium text-neutral-fg2 transition-colors hover:bg-neutral-bg-hover",children:n("common.cancel")}),e.jsx("button",{onClick:U,className:"rounded-md bg-brand px-6 py-2.5 text-[14px] font-medium text-white transition-all hover:bg-brand-hover",children:n("common.save")})]})]})]})})}export{ae as A};
