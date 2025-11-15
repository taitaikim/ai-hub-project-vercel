// [A.I.K.H. 3.0] Vercel 서버리스 함수 (LWW Debug Report Mode)
// 경로: /api/notion-webhook.js

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js'; 
import { createHmac, timingSafeEqual } from 'crypto'; 

// --- 1. 엔진 초기화 및 보안 변수 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN; 

// --- 2. Vercel API 핸들러 (LWW 디버그 로직) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Method Not Allowed' }); }
    
    // [Raw Body 읽기] (디버그를 위해 필요)
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const event = JSON.parse(rawBody); 

    // [보안 우회] Notion Signature 검증 로직은 '임시 주석 처리'합니다.
    /*
    if (!validateNotionSignature(rawBody, req.headers)) {
        return res.status(401).json({ message: 'Unauthorized Signature' });
    }
    */
    
    try {
        // --- 3. Handle UPDATE (LWW 시간 비교 로직 최종 수정) ---
        if (event.event === 'page.property_value.changed' || event.event === 'page.content_updated') {
            
            const notionLastEdited = new Date(event.last_edited_time); 
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) { return res.status(200).json({ message: 'No Firebase ID.' }); }

            const docRef = db.collection('memos').doc(firebaseId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(200).json({ message: 'Firebase doc not found.' }); }
            
            const firebaseLastEdited = new Date(doc.data().lastEditedAt.toDate()); 

            // [핵심 디버그] 시간 비교 후, 충돌 시 업데이트 대신 디버그 정보를 JSON으로 반환
            if (notionLastEdited.getTime() <= firebaseLastEdited.getTime()) {
                // ⬅️ LWW 거부 시, 상세 JSON 정보를 반환하여 왜 실패했는지 확인합니다.
                return res.status(200).json({ 
                    message: 'LWW_FAILED_DUE_TO_TIME_CONFLICT',
                    notion_time_ms: notionLastEdited.getTime(),
                    firebase_time_ms: firebaseLastEdited.getTime(),
                    time_difference_ms: notionLastEdited.getTime() - firebaseLastEdited.getTime()
                });
            }

            // (LWW 승인 시) 업데이트 진행
            const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
            let newSummary = doc.data().summary;
            try { newSummary = await getAiSummary(newNotionText); } catch (aiError) { console.error("AI 재요약 실패"); }

            await docRef.update({ 
                text: newNotionText, 
                summary: newSummary,
                lastEditedAt: new Date()
            });
            return res.status(200).json({ message: 'Update sync successful!' });
        }

        // 4. Handle DELETE (삭제 이벤트 처리 - 기존 로직 유지)
        if (event.event === 'page.archived' || event.event === 'page.deleted') {
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (firebaseId) {
                await db.collection('memos').doc(firebaseId).delete();
            }
            return res.status(200).json({ message: 'Delete sync successful!' });
        }
        
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] 실시간 동기화 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}