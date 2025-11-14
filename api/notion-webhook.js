// [A.I.K.H. 2.0] Vercel 서버리스 함수 (S6 대체)
// 경로: /api/notion-webhook.js
// 이 API는 'Notion'이 '직접' 호출합니다.

// --- 1. 엔진 임포트 ---
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { Client } from '@notionhq/client';

// --- 2. 엔진 초기화 (Vercel 환경 변수) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');

const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

const db = getFirestore(app);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// [중요] Notion Webhook은 'Webhook 전용' 인증을 사용해야 합니다.
// Vercel 환경 변수 'NOTION_WEBHOOK_SECRET'에 '직접 생성한' 비밀 키를 넣어야 합니다.
const NOTION_WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;

// Notion API 클라이언트는 Webhook 수신 시 '사용되지 않습니다'.
// (단, AI 재요약을 위해 DB에 접근할 수는 있습니다.)

// --- 3. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [보안 2] Notion Webhook '비밀 키' 검증 (필수!)
    // Notion이 보낸 'ntn-webhook-secret' 헤더가 내 비밀 키와 일치하는지 확인
    const notionSecret = req.headers['ntn-webhook-secret'];
    if (notionSecret !== NOTION_WEBHOOK_SECRET) {
        console.warn("🔥 [Notion Webhook] 비정상적 접근 감지! (비밀 키 불일치)");
        return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log("🔄 [Notion Webhook] Notion으로부터 '실시간' 변경 신호 수신!");
    const event = req.body;

    // [로직] '페이지 속성'이 '수정'된 이벤트만 처리
    if (event.event !== 'page.property_value.changed') {
        // (로그만 남기고 정상 종료)
        console.log(`🔄 [Notion Webhook] 단순 변경 이벤트 수신 (Type: ${event.event}). 동기화 불필요.`);
        return res.status(200).json({ message: 'Event received but not processed.' });
    }

    try {
        // [핵심] '어떤' 페이지가 '어떻게' 바뀌었는지 Notion이 알려줍니다.
        const pageId = event.page_id;
        const changedProperty = event.property_name;
        
        // [중요!] 우리는 'Original Text' 속성이 바뀔 때만 재요약을 실행합니다.
        if (changedProperty !== "Original Text") {
             console.log(`🔄 [Notion Webhook] '${changedProperty}' 속성 변경. (Original Text 아님) 동기화 불필요.`);
             return res.status(200).json({ message: 'Property change ignored.' });
        }

        // [데이터 추출] Notion이 보낸 정보에서 'Firebase Doc ID'와 '수정된 텍스트'를 찾습니다.
        // (실제 Notion이 보내는 Webhook payload 구조는 매우 복잡하여,
        //  '정확한' 값 추출을 위해선 '테스트'가 필요합니다.)
        
        // [가정] Notion이 보낸 데이터(event.properties)에서 값을 추출합니다.
        // (이 부분은 '실제' Notion Webhook '테스트' 후 '반드시' 검증/수정해야 합니다.)
        const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
        const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';

        if (!firebaseId) {
            console.warn(`🟡 [Notion Webhook] Firebase ID를 찾을 수 없어 동기화를 건너뜁니다.`);
            return res.status(200).json({ message: 'Sync skipped: Firebase ID not found in payload.' });
        }

        console.log(`🔄 [Notion Webhook] '${firebaseId}' 문서가 Notion에서 수정됨! Firebase 업데이트를 시작합니다.`);

        // 1. Firebase에서 원본 문서 확인
        const docRef = db.collection('memos').doc(firebaseId);
        const doc = await docRef.get();
        if (!doc.exists) {
            console.warn(`🟡 [Notion Webhook] '${firebaseId}' 문서를 Firebase에서 찾을 수 없습니다.`);
            return res.status(200).json({ message: 'Sync skipped: Firebase doc not found.' });
        }

        // 2. 텍스트가 '실제로' 다를 경우에만 AI 재요약 및 업데이트 (비용 절감)
        if (doc.data().text !== newNotionText) {
            let newSummary = doc.data().summary;
            try {
                // 3. AI 재요약 (공용 함수)
                newSummary = await getAiSummary(newNotionText);
            } catch (aiError) {
                console.error("🔥 [Notion Webhook] AI 재요약 실패", aiError);
            }

            // 4. Firebase에 '덮어쓰기'
            await docRef.update({
                text: newNotionText,
                summary: newSummary
            });
            console.log(`✅ [Notion Webhook] '${firebaseId}' 문서를 'Notion' 기준으로 'Firebase'에 덮어썼습니다!`);
        } else {
             console.log(`🔄 [Notion Webhook] 텍스트가 동일하여 덮어쓰기를 건너뜁니다.`);
        }

        // 5. Notion에 "처리 완료" 신호 전송
        return res.status(200).json({ message: 'Sync successful!' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] '실시간 동기화' 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

// --- 🛠️ (공용 함수) AI 요약 ---
// (api/kakao.js에 있던 함수와 100% 동일한 로직)
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