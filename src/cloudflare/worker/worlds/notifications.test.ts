import { afterEach, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { sendWorldPublicationDecisionEmail, sendWorldMembershipApprovedEmail } from './notifications';
import type { WorldPublicationRequest } from '../../../worlds/model';
const mail=vi.hoisted(()=>({send:vi.fn(),configured:true}));
vi.mock('../email/provider',()=>({emailConfigured:()=>mail.configured,createEmailClient:()=>({emails:{send:mail.send}})}));
const opened:ReturnType<typeof fixture>[]=[];
const setup=()=>{const f=fixture();opened.push(f);return f;};
afterEach(()=>{for(const f of opened.splice(0))f.sqlite.close();vi.clearAllMocks();mail.configured=true;});
const request=new Request('https://api.wamp.land/api/worlds/one/publication-requests/review');
const publication={submittedByUserId:'p1',roomTitle:'<Lava>',roomCoordinates:{x:129,y:0},status:'rejected',rejectionReason:'Add <an exit>'} as WorldPublicationRequest;
it('sends the builder the outcome, escaped reason and a request link through the configured provider',async()=>{
 const f=setup();mail.send.mockResolvedValue({data:{id:'local'},error:null});
 expect(await sendWorldPublicationDecisionEmail(request,f.env,{worldNumber:1,publication})).toMatchObject({sent:true});
 const message=mail.send.mock.calls[0][0];expect(message.to).toBe('p1@example.test');expect(message.text).toContain('Add <an exit>');
 expect(message.html).toContain('Add &lt;an exit&gt;');expect(message.html).not.toContain('<an exit>');expect(message.text).toContain('/w/1?worlds=manage');
 await sendWorldPublicationDecisionEmail(request,f.env,{worldNumber:1,publication:{...publication,status:'approved'}});
 expect(mail.send.mock.calls[1][0].text).toContain('is now published');expect(mail.send.mock.calls[1][0].text).not.toContain('Add <an exit>');
 await sendWorldMembershipApprovedEmail(request,f.env,{userId:'p1',worldNumber:1});expect(mail.send.mock.calls[2][0].text).toContain('claim and edit');
});
it('skips missing email, student accounts and an unconfigured provider',async()=>{
 const f=setup();f.sqlite.exec("UPDATE users SET email=NULL WHERE id='p1'");
 expect(await sendWorldPublicationDecisionEmail(request,f.env,{worldNumber:1,publication})).toMatchObject({attempted:false});
 f.sqlite.exec("UPDATE users SET email='student@example.test' WHERE id='p1'; INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at) VALUES ('s','s','School','teacher@example.test','2026','2026'); INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES ('s','s','p1','student','hash','2026','2026','2026')");
 expect(await sendWorldPublicationDecisionEmail(request,f.env,{worldNumber:1,publication})).toMatchObject({attempted:false});
 mail.configured=false;expect(await sendWorldMembershipApprovedEmail(request,f.env,{userId:'builder',worldNumber:1})).toMatchObject({attempted:false});expect(mail.send).not.toHaveBeenCalled();
});
it('reports a provider failure without undoing a decision',async()=>{
 const f=setup();mail.send.mockRejectedValue(new Error('temporarily unavailable'));
 expect(await sendWorldPublicationDecisionEmail(request,f.env,{worldNumber:1,publication})).toMatchObject({attempted:true,sent:false,error:'temporarily unavailable'});
});
