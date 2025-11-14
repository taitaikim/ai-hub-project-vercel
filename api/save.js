// [A.I.K.H. 2.0] Vercel 서버리스 함수
// 경로: /api/save.js

// --- 1. '중앙 통제실'에서 '모든' 부품 가져오기 ---
import {
    db,
    auth,
    openai,
    notion,
    NOTION_DATABASE_ID,
    verifyToken
} from '../../_lib/ai-hub.js';
// (엔진 초기화 코드가 '전부' 사라져 '깨끗'해졌습니다!)

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [보안 2] '보안 검사관' 호출!
    const user = await verifyToken(req, res);
    if (!user) {
        return; // 인증 실패 (보안 검사관이 이미 응답함)
    }

    // --- 3. '인증된 사용자'만 실행하는 비즈니스 로직 ---
    // (기존 server.js의 '/api/save' 로직과 100% 동일)
    try {
        const receivedMemo = req.body.memo;
        const uid = user.uid;
        const savedDate = new Date();
        let aiSummary = '';

        // [STEP 1] AI 요약 (공용 함수 사용)
        try {
            aiSummary = await getAiSummary(receivedMemo);
        } catch (aiError) {
            console.error("🔥 [Vercel] AI 요약 실패", aiError);
            aiSummary = "AI 요약에 실패했습니다.";
        }

        // [STEP 2] Firebase 저장 (원천 데이터)
        const docRef = await db.collection('memos').add({
            uid: uid,
            text: receivedMemo,
            summary: aiSummary,
            createdAt: savedDate,
            notionPageId: null // (Notion ID는 나중에 채워짐)
        });
        const firebaseId = docRef.id;
        console.log(`🚀 [Firebase] '${uid}' 손님의 메모 저장 성공! (ID: ${firebaseId})`);

        // [STEP 3] Notion에 동시 저장 (공용 함수 사용)
        const notionPage = await saveToNotion(uid, receivedMemo, aiSummary, savedDate, firebaseId);
        console.log(`🚀 [Notion] '${uid}' 손님의 메모를 Notion DB에 동시 저장 성공!`);

        // [STEP 4] 'Firebase'에 'Notion ID'도 기록 (양방향 동기화 기반)
        await docRef.update({ notionPageId: notionPage.id });

        // [성공]
        return res.status(200).json({ message: "메모가 'Firebase와 Notion'에 영구 저장되었습니다!" });

    } catch (dbError) {
        console.error('🔥 [Vercel] 저장 실패!', dbError);
        // [실패]
        return res.status(500).json({ message: "서버에서 저장 중 오류 발생" });
    }
}


// --- 🛠️ (공용 함수) AI 요약 ---
// (이 함수들은 '중앙 통제실'의 'openai' 엔진을 사용합니다)
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

// --- 🛠️ (공용 함수) Notion 저장 ---
// (이 함수들은 '중앙 통제실'의 'notion' 엔진을 사용합니다)
async function saveToNotion(uid, text, summary, date, firebaseId) {
    const response = await notion.pages.create({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
            "Original Text": { title: [{ text: { content: text.substring(0, 100) } }] },
            "AI Summary": { rich_text: [{ text: { content: summary } }] },
            "Firebase UID": { rich_text: [{ text: { content: uid } }] },
            "Saved At": { date: { start: date.toISOString() } },
            "Firebase Doc ID": { rich_text: [{ text: { content: firebaseId } }] }
        }
    });
    return response;
}