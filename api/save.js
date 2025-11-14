// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 4)
// 경로: /api/save.js
// (버그: 'import' 경로를 './lib/ai-hub.js'로 수정)

import {
    db,
    auth,
    openai,
    notion,
    NOTION_DATABASE_ID,
    verifyToken,
    getAiSummary,
    saveToNotion
} from './lib/ai-hub.js'; // ⬅️ [최종 수정!]

// --- (이하 코드는 100% 동일 / '공용 함수'만 '삭제') ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }
    try {
        const receivedMemo = req.body.memo;
        const uid = user.uid;
        const savedDate = new Date();
        let aiSummary = '';
        try {
            aiSummary = await getAiSummary(receivedMemo);
        } catch (aiError) {
            console.error("🔥 [Vercel] AI 요약 실패", aiError);
            aiSummary = "AI 요약에 실패했습니다.";
        }
        const docRef = await db.collection('memos').add({
            uid: uid,
            text: receivedMemo,
            summary: aiSummary,
            createdAt: savedDate,
            notionPageId: null 
        });
        const firebaseId = docRef.id;
        console.log(`🚀 [Firebase] '${uid}' 손님의 메모 저장 성공! (ID: ${firebaseId})`);
        const notionPage = await saveToNotion(uid, receivedMemo, aiSummary, savedDate, firebaseId);
        console.log(`🚀 [Notion] '${uid}' 손님의 메모를 Notion DB에 동시 저장 성공!`);
        await docRef.update({ notionPageId: notionPage.id });
        return res.status(200).json({ message: "메모가 'Firebase와 Notion'에 영구 저장되었습니다!" });
    } catch (dbError) {
        console.error('🔥 [Vercel] 저장 실패!', dbError);
        return res.status(500).json({ message: "서버에서 저장 중 오류 발생" });
    }
}