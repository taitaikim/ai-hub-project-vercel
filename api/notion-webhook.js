// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 5)
// 경로: /api/notion-webhook.js
// (버그: 'JSON 번역기' 추가)

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js'; 

// --- 1. 엔진 초기화 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const NOTION_WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // --- 👇 [S6-FIX] 'JSON 번역기' 로직 (필수!) 👇 ---
    // Vercel은 'express.json()'이 없으므로, '수동'으로 '번역'해야 합니다.
    let event;
    try {
        // 'req.body'를 '텍스트'로 '강제' 변환 후 'JSON'으로 '파싱'
        event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
        console.error("🔥 [Notion Webhook] JSON 파싱 실패!", e);
        return res.status(400).json({ message: 'Invalid JSON' });
    }
    // --- 👆 [S6-FIX] 'JSON 번역기' 로직 끝 👆 ---


    // [S6-FIX] Notion '인증' 요청 처리 (최우선)
    if (event.challenge) {
        console.log("✅ [Notion Webhook] '인증 토큰(challenge)' 수신! 즉시 응답합니다.");
        console.log(`⭐️ 인증 토큰: ${event.challenge} ⭐️`);
        return res.status(200).json({ challenge: event.challenge });
    }

    // [보안 2] '실제 데이터' 수신 시 '비밀 키' 검증
    const notionSecret = req.headers['ntn-webhook-secret'];
    if (notionSecret !== NOTION_WEBHOOK_SECRET) {
        console.warn("🔥 [Notion Webhook] 비정상적 접근 감지! (비밀 키 불일치)");
        return res.status(401).json({ message: 'Unauthorized' });
    }

    // --- (이하 코드는 100% 동일) ---
    // ( ... 기존 'page.property_value.changed' 및 'page.archived' 로직 ... )
    try {
        if (event.event === 'page.property_value.changed') {
            console.log("🔄 [Notion Webhook] '페이지 수정' 신호 수신!");
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
            if (!firebaseId || event.property_name !== "Original Text") {
                 console.log(`🔄 [Notion Webhook] (Original Text 아님) 동기화 불필요.`);
                 return res.status(200).json({ message: 'Property change ignored.' });
            }
            console.log(`🔄 [Notion Webhook] '${firebaseId}' 문서가 Notion에서 수정됨! Firebase 업데이트를 시작합니다.`);
            const docRef = db.collection('memos').doc(firebaseId);
            const doc = await docRef.get();
            if (!doc.exists) {
                console.warn(`🟡 [Notion Webhook] '${firebaseId}' 문서를 Firebase에서 찾을 수 없습니다.`);
                return res.status(200).json({ message: 'Sync skipped: Firebase doc not found.' });
            }
            if (doc.data().text !== newNotionText) {
                let newSummary = doc.data().summary;
                try { newSummary = await getAiSummary(newNotionText); } 
                catch (aiError) { console.error("🔥 [Notion Webhook] AI 재요약 실패", aiError); }
                await docRef.update({ text: newNotionText, summary: newSummary });
                console.log(`✅ [Notion Webhook] '${firebaseId}' 문서를 'Notion' 기준으로 'Firebase'에 덮어썼습니다!`);
            } else {
                 console.log(`🔄 [Notion Webhook] 텍스트가 동일하여 덮어쓰기를 건너뜁니다.`);
            }
            return res.status(200).json({ message: 'Sync successful!' });
        }
        if (event.event === 'page.archived' || event.event === 'page.deleted') {
            console.log("🔄 [Notion Webhook] '페이지 삭제(보관)' 신호 수신!");
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) {
                console.warn(`🟡 [Notion Webhook] Firebase ID를 찾을 수 없어 '삭제 동기화'를 건너뜁니다.`);
                return res.status(200).json({ message: 'Sync skipped: Firebase ID not found.' });
            }
            const docRef = db.collection('memos').doc(firebaseId);
            await docRef.delete();
            console.log(`✅ [Notion Webhook] '${firebaseId}' 문서를 'Notion' 기준으로 'Firebase'에서 '삭제'했습니다!`);
            return res.status(200).json({ message: 'Delete sync successful!' });
        }
        console.log(`🔄 [Notion Webhook] 처리 불필요한 이벤트 수신 (Type: ${event.event}).`);
        return res.status(200).json({ message: 'Event received but not processed.' });
    } catch (error) {
        console.error("🔥 [Notion Webhook] '실시간 동기화' 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}