import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST:RequestHandler=async({locals,request})=>{
 if(!await locals.getVerifiedUser())return json({message:'Sign in to read the Codex.'},{status:401});
 let body:unknown;try{body=await request.json();}catch{return json({message:'Invalid report request.'},{status:400});}
 const input=body as {reportIds?:unknown;seenOnly?:unknown};
 if(!Array.isArray(input?.reportIds)||input.reportIds.length>100||input.reportIds.some(id=>typeof id!=='string'||id.length>240)||input.seenOnly!==undefined&&typeof input.seenOnly!=='boolean')return json({message:'Invalid report request.'},{status:400});
 const {error}=await (locals.supabase.rpc as any)('codex_reports_ack',{p_report_ids:input.reportIds,p_read:input.seenOnly!==true});
 if(error)return json({message:'The Codex could not save your reading place. Please retry.'},{status:500});
 return json({success:true});
};
