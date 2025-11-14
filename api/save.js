// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 6 - 'JSON 파서' 최종 통합본)
// 경로: /api/save.js

// --- 1. '통제실'에서 '부품' 가져오기 ---
import {
    db,
    auth,
    openai,
    notion,
    NOTION_DATABASE_ID,
    verifyToken,
    getAiSummary,
    saveToNotion
} from './lib/ai-hub.js'; // (O) './lib/' (api/lib/...)

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [보안 2] '보안 검사관' 호출
    const user = await verifyToken(req, res);
    if (!user) {
        return; // 인증 실패
    }

    // --- 👇 [S6-FIX] 'JSON 번역기' 로직 (필수!) 👇 ---
    let requestBody;
    try {
        // Vercel은 'req.body'가 '텍스트'일 수 있으므로 '수동' 파싱
        requestBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
        console.error("🔥 [Save] JSON 파싱 실패!", e);
        return res.status(400).json({ message: 'Invalid JSON' });
    }
    // --- 👆 [S6-FIX] 'JSON 번역기' 로직 끝 👆 ---

    // --- 3. '인증된 사용자'만 실행하는 비즈니스 로직 ---
    try {
        // [수정!] 'req.body'가 아닌 'requestBody' 사용
        const receivedMemo = requestBody.memo;
        const uid = user.uid;
        const savedDate = new Date();
        let aiSummary = '';

        // [STEP 1] AI 요약 (공용 함수)
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

        // [STEP 3] Notion에 동시 저장 (공용 함수)
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