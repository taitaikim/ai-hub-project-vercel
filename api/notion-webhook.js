// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Zero-Error / 'JSON 파서' 및 '가짜 보안' 제거)
// 경로: /api/notion-webhook.js

// [수정!] 'Notion Webhook'은 'AI 요약' 외에 '공용 함수'가 '불필요'
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAiSummary } from './lib/ai-hub.js'; 

// --- 1. 엔진 초기화 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);

// [수정!] 'NOTION_WEBHOOK_SECRET' (가짜 보안) '완전' 삭제!
// const NOTION_WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET; // ⬅️ [삭제!]

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [수정!] 'JSON 번역기' ('수동' 파싱) '삭제!' (Vercel '자동' 파싱 사용)
    const event = req.body;

    // --- 👇 [S6-FIX] Notion '인증' 요청 처리 (최우선) 👇 ---
    // (이것이 '진짜' Notion의 '보안' 방식입니다)
    if (event.challenge) {
        console.log("✅ [Notion Webhook] '인증 토큰(challenge)' 수신! 즉시 응답합니다.");
        console.log(`⭐️ 인증 토큰: ${event.challenge} ⭐️`); // ⬅️ 이 '토큰'을 '복사'해야 합니다!
        return res.status(200).json({ challenge: event.challenge });
    }
    // --- 👆 [S6-FIX] 인증 로직 끝 👆 ---

    // [수정!] '가짜 보안' (비밀 키 검증) '완전' 삭제!
    // const notionSecret = req.headers['ntn-webhook-secret']; // ⬅️ [삭제!]
    // if (notionSecret !== NOTION_WEBHOOK_SECRET) { ... } // ⬅️ [삭제!]


    // --- (이하 '동기화' 로직 100% 동일) ---
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
                await docRef.update({ text: newText, summary: newSummary });
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