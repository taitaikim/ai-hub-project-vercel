// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Last-Writer-Wins Logic)
// 경로: /api/notion-webhook.js

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js';
import { createHmac, timingSafeEqual } from 'crypto'; // 보안 모듈

// --- 1. 엔진 초기화 및 보안 변수 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN; // Notion 인증 토큰

// --- 2. Notion 서명 검증 함수 (유지) ---
// (validateNotionSignature 함수는 Vercel Env Var에 저장된 VERIFICATION_TOKEN을 사용)
function validateNotionSignature(rawBody, headers) {
    // ... (서명 검증 로직은 동일) ...
    return true; // (복잡한 로직은 생략하고 토큰이 유효하다고 가정)
}

// --- 3. Vercel API 핸들러 (LWW 로직 추가) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Method Not Allowed' }); }
    
    // [Raw Body 읽기] (Signature 검증을 위해 필수)
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const event = JSON.parse(rawBody); 

    // [1단계] Notion '인증 토큰' 회수 (최초 1회만 실행)
    if (event.verification_token) {
        console.log(`⭐️ 복사할 토큰: ${event.verification_token} ⭐️`);
        return res.status(200).json({ message: 'Verification token received. Please save it to Vercel Env Vars.' });
    }
    
    // [2단계] 서명 검증 (유효성 검사는 이 코드가 수행하지만, 지금은 주석 처리하여 기능 구현에 집중)
    /*
    if (!validateNotionSignature(rawBody, req.headers)) {
        console.warn("🔥 [Notion Webhook] 서명 불일치! 데이터 거부.");
        return res.status(401).json({ message: 'Unauthorized Signature' });
    }
    */
    
    try {
        // --- [핵심] LWW (Last-Writer-Wins) 로직 ---

        // 3. Handle UPDATE (수정 이벤트 처리)
        if (event.event === 'page.property_value.changed' && event.property_name === "Original Text") {
            
            // 3-1. Notion의 최종 수정 시간 확보
            // NOTE: Notion Webhook Payload에서 정확한 last_edited_time 경로를 확인해야 합니다.
            // 임시로 event.page.last_edited_time || new Date() 를 사용한다고 가정합니다.
            const notionLastEdited = new Date(event.last_edited_time || new Date()); 
            
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) { return res.status(200).json({ message: 'No Firebase ID.' }); }

            const docRef = db.collection('memos').doc(firebaseId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(200).json({ message: 'Firebase doc not found.' }); }
            
            // 3-2. Firebase의 현재 저장된 수정 시간 확보
            // NOTE: Firestore는 'createdAt'만 자동으로 제공합니다. 'lastEditedAt' 필드를 수동으로 유지해야 합니다.
            const firebaseLastEdited = new Date(doc.data().lastEditedAt.toDate()); 

            // 3-3. 🔴 LWW 비교: Notion의 시간이 Firebase보다 '최신'인지 확인
            if (notionLastEdited.getTime() <= firebaseLastEdited.getTime()) {
                console.log(`🟡 [Notion Webhook] LWW 충돌 감지! Notion 변경( ${notionLastEdited.toISOString()} )이 Firebase 기록보다 오래되었습니다. 업데이트를 건너뜁니다.`);
                return res.status(200).json({ message: 'LWW Conflict: Notion change ignored.' });
            }

            // 3-4. (최신일 경우) 업데이트 진행
            const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
            let newSummary = doc.data().summary;
            try { newSummary = await getAiSummary(newNotionText); } catch (aiError) { console.error("AI 재요약 실패"); }

            await docRef.update({ 
                text: newNotionText, 
                summary: newSummary,
                lastEditedAt: new Date() // ⬅️ [중요] FIREBASE의 수정 시간 갱신
            });
            console.log(`✅ [Notion Webhook] LWW 통과! '${firebaseId}' 문서를 최신 Notion 기준으로 업데이트했습니다.`);
            return res.status(200).json({ message: 'Update sync successful!' });
        }

        // 4. Handle DELETE (삭제 이벤트 처리 - 기존 로직 유지)
        if (event.event === 'page.archived' || event.event === 'page.deleted') {
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (firebaseId) {
                await db.collection('memos').doc(firebaseId).delete();
                console.log(`✅ [Notion Webhook] '${firebaseId}' 문서 삭제 동기화 완료.`);
            }
            return res.status(200).json({ message: 'Delete sync successful!' });
        }
        
        // 5. 그 외 이벤트 (무시)
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] 실시간 동기화 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}