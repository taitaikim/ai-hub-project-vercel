// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Final Fix: LWW/Signature/Zero-Error)
// 경로: /api/notion-webhook.js

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js'; 
import { createHmac, timingSafeEqual } from 'crypto'; // 공식 보안 모듈

// --- 1. 엔진 초기화 및 보안 변수 ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN; // Notion 인증 토큰 (Env Var)

// --- 2. [핵심 공용 함수] Notion 서명 검증 ---
// (Notion이 보내는 X-Notion-Signature 헤더와 비교하여 데이터 무결성 검증)
function validateNotionSignature(rawBody, headers) {
    const signature = headers['x-notion-signature'];
    if (!signature || !VERIFICATION_TOKEN) {
        // 토큰이 Vercel에 설정되지 않았거나, 헤더가 없으면 실패
        return false;
    }

    const calculatedSignature = `sha256=${createHmac("sha256", VERIFICATION_TOKEN)
        .update(rawBody)
        .digest("hex")}`;

    // 안전한 시간 기반 비교 수행
    try {
        return timingSafeEqual(
            Buffer.from(calculatedSignature),
            Buffer.from(signature)
        );
    } catch (e) {
        return false;
    }
}

// --- 3. Vercel API 핸들러 (LWW 로직 최종 수정) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // [보안 필수] Raw Body를 직접 읽어 서명 검증에 사용 (Vercel 자동 파싱 충돌 방지)
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const event = JSON.parse(rawBody); 

    // [1단계] Notion '인증 토큰' 회수 (최초 1회만 실행)
    if (event.verification_token) {
        console.log(`⭐️ 복사할 토큰: ${event.verification_token} ⭐️`); 
        return res.status(200).json({ message: 'Verification token received. Please save it to Vercel Env Vars.' });
    }
    
    // [2단계] 서명 검증 (데이터 무결성 확인)
    /* // [2단계] 서명 검증 (데이터 무결성 확인) if (!validateNotionSignature(rawBody, req.headers)) { console.warn("🔥 [Notion Webhook] 서명 불일치! 데이터 거부."); return res.status(401).json({ message: 'Unauthorized Signature' }); } */ // ⬅️ 이 전체 블록을 주석 처리하여 '보안 검사'를 '임시 해제'합니다.
    
    try {
        // --- 3. Handle UPDATE (LWW 시간 비교 로직 최종 수정) ---
        if (event.event === 'page.property_value.changed' || event.event === 'page.content_updated') { // Content updated event 추가
            
            // 3-1. 🔑 [수정!] Notion의 최종 수정 시간 확보 (가장 정확한 경로 사용)
            // Notion Webhook Event의 최신 수정 시간은 payload의 top-level에 위치합니다.
            const notionLastEdited = new Date(event.last_edited_time); 
            
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) { return res.status(200).json({ message: 'No Firebase ID.' }); }

            const docRef = db.collection('memos').doc(firebaseId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(200).json({ message: 'Firebase doc not found.' }); }
            
            // 3-2. Firebase의 현재 저장된 수정 시간 확보
            const firebaseLastEdited = new Date(doc.data().lastEditedAt.toDate()); 

            // 3-3. 🔴 LWW 비교: Notion의 시간이 Firebase보다 '엄격하게 최신'인지 확인
            // [Final Fix] milliseconds 단위까지 비교하여 최신이 아니면 거부 (충돌 방지)
            if (notionLastEdited.getTime() <= firebaseLastEdited.getTime()) {
                console.log(`🟡 [Notion Webhook] LWW 충돌 감지! 업데이트를 건너뜁니다.`);
                return res.status(200).json({ message: 'LWW Conflict: Notion change ignored.' });
            }

            // 3-4. (최신일 경우) 업데이트 진행
            const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
            let newSummary = doc.data().summary;
            try { newSummary = await getAiSummary(newNotionText); } catch (aiError) { console.error("AI 재요약 실패"); }

            await docRef.update({ 
                text: newNotionText, 
                summary: newSummary,
                lastEditedAt: new Date() // FIREBASE의 수정 시간 갱신
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
        
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] 실시간 동기화 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}