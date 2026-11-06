import {createHash} from 'node:crypto';
import {categoryLabel} from '../../shared/idea-category';
export const categoryInputHash=(idea:any)=>createHash('sha256').update(JSON.stringify([idea.title||'',idea.description||''])).digest('hex');
export function categoryMetadata(label:unknown,idea:any,runId?:string){
 const value=categoryLabel(label);return value?{version:3,label:value,inputHash:categoryInputHash(idea),generatedAt:new Date().toISOString(),runId}:undefined;
}
export function withIdeaCategory(idea:any){
 if(idea.contentCategory?.version===3&&idea.contentCategory?.inputHash===categoryInputHash(idea)&&categoryLabel(idea.contentCategory?.label))return idea;
 const {contentCategory,...rest}=idea;return rest;
}
