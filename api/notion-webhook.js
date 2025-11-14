// [A.I.K.H. 2.0] Vercel 서버리스 함수 (S6 대체 / '인증 로직' 수정됨)
// 경로: /api/notion-webhook.js

// --- 1. 엔진 임포트 (기존과 동일) ---
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';

// --- 2. 엔진 초기화 (기존과 동일) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const NOTION_WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;

// --- 3. Vercel API 핸들러 ('인증' 로직 추가됨) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용 (기존과 동일)
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const event = req.body;

    // --- 👇 [S6-FIX] Notion '인증' 요청 처리 (최우선) 👇 ---
    // Notion이 'challenge' 토큰을 보내면, '즉시' 응답해야 합니다.
    if (event.challenge) {
        console.log("✅ [Notion Webhook] '인증 토큰(challenge)' 수신! 즉시 응답합니다.");
        
        // ⭐️ '인증 토큰'을 찾아서 Notion 팝업에 붙여넣으세요! ⭐️
        console.log(`⭐️ 인증 토큰: ${event.challenge} ⭐️`);
        
        // Notion에 'challenge' 값을 그대로 돌려보냅니다.
        return res.status(200).json({ challenge: event.challenge });
    }
    // --- 👆 [S6-FIX] 인증 로직 끝 👆 ---

    // [보안 2] '실제 데이터' 수신 시 '비밀 키' 검증 (필수!)
    // (인증 요청이 아닌, '실제' 데이터 업데이트일 때만 실행)
    const notionSecret = req.headers['ntn-webhook-secret'];
    if (notionSecret !== NOTION_WEBHOOK_SECRET) {
        console.warn("🔥 [Notion Webhook] 비정상적 접근 감지! (비밀 키 불일치)");
        return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log("🔄 [Notion Webhook] Notion으로부터 '실시간' 변경 신호 수신!");

    // [로직] '페이지 속성'이 '수정'된 이벤트만 처리 (기존과 동일)
    if (event.event !== 'page.property_value.changed') {
        console.log(`🔄 [Notion Webhook] 단순 변경 이벤트 수신 (Type: ${event.event}). 동기화 불필요.`);
        return res.status(200).json({ message: 'Event received but not processed.' });
    }

    try {
        // [데이터 추출] (기존 로직과 100% 동일)
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

// --- 🛠️ (공용 함수) AI 요약 (기존과 동일) ---
async function getAiSummary(text) {
    console.log('🤖 [AI] (공용함수) 요약 요청...');
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "You are a helpful assistant that summarizes text in one concise Korean sentence." },
            { role: "user", content: text }
        ],
    });
    return completion.choices[0].message.content;
}