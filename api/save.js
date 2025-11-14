// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Zero-Error / 'JSON 파서' 제거)
// 경로: /api/save.js

import { db, auth, verifyToken, getAiSummary, saveToNotion } from './lib/ai-hub.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }

    // [수정!] 'JSON 번역기' ('수동' 파싱) '삭제!' (Vercel '자동' 파싱 사용)
    const requestBody = req.body;

    try {
        const receivedMemo = requestBody.memo;
        const uid = user.uid;
        const savedDate = new Date();
        let aiSummary = '';

        // ... (이하 '저장' 로직 100% 동일) ...
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