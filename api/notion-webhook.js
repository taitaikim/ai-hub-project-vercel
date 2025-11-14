// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 4)
// 경로: /api/notion-webhook.js
// (버그: 'import' 경로를 './lib/ai-hub.js'로 수정)

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
// ⭐️ [수정!] 'ai-hub.js'가 아닌, '직접' 초기화 (Webhook은 공용 함수가 적음)
// ⭐️ 'getAiSummary'는 'ai-hub.js'에서 가져옵니다.
import { getAiSummary } from './lib/ai-hub.js'; // ⬅️ [최종 수정!]

// --- (이하 코드는 100% 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const NOTION_WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const event = req.body;
    if (event.challenge) {
        console.log("✅ [Notion Webhook] '인증 토큰(challenge)' 수신! 즉시 응답합니다.");
        console.log(`⭐️ 인증 토큰: ${event.challenge} ⭐️`);
        return res.status(200).json({ challenge: event.challenge });
    }
    const notionSecret = req.headers['ntn-webhook-secret'];
    if (notionSecret !== NOTION_WEBHOOK_SECRET) {
        console.warn("🔥 [Notion Webhook] 비정상적 접근 감지! (비밀 키 불일치)");
        return res.status(401).json({ message: 'Unauthorized' });
    }
    console.log("🔄 [Notion Webhook] Notion으로부터 '실시간' 변경 신호 수신!");
    if (event.event !== 'page.property_value.changed') {
        console.log(`🔄 [Notion Webhook] 단순 변경 이벤트 수신 (Type: ${event.event}). 동기화 불필요.`);
        return res.status(200).json({ message: 'Event received but not processed.' });
    }
    try {
        const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
        const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
        if (!firebaseId) {
            console.warn(`🟡 [Notion Webhook] Firebase ID를 찾을 수 없어 동기화를 건너뜁니다.`);
            return res.status(200).json({ message: 'Sync skipped: Firebase ID not found in payload.' });
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
            try {
                newSummary = await getAiSummary(newNotionText);
            } catch (aiError) {
                console.error("🔥 [Notion Webhook] AI 재요약 실패", aiError);
            }
            await docRef.update({
                text: newNotionText,
                summary: newSummary
            });
            console.log(`✅ [Notion Webhook] '${firebaseId}' 문서를 'Notion' 기준으로 'Firebase'에 덮어썼습니다!`);
        } else {
             console.log(`🔄 [Notion Webhook] 텍스트가 동일하여 덮어쓰기를 건너뜁니다.`);
        }
        return res.status(200).json({ message: 'Sync successful!' });
    } catch (error) {
        console.error("🔥 [Notion Webhook] '실시간 동기화' 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}