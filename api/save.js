// [A.I.K.H. 3.0] Vercel 서버리스 함수 (LWW 적용)
// 경로: /api/save.js

import { db, verifyToken, getAiSummary, saveToNotion } from './lib/ai-hub.js';

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

        // [STEP 1] AI 요약
        try {
            aiSummary = await getAiSummary(receivedMemo);
        } catch (aiError) {
            console.error("🔥 [Vercel] AI 요약 실패", aiError);
            aiSummary = "AI 요약에 실패했습니다.";
        }

        // [STEP 2] Firebase 저장 (원천 데이터 생성)
        const docRef = await db.collection('memos').add({
            uid: uid,
            text: receivedMemo,
            summary: aiSummary,
            createdAt: savedDate,
            notionPageId: null, 
            lastEditedAt: new Date(), // ⬅️ [LWW 핵심] 현재 시간 기록 추가
        });
        const firebaseId = docRef.id;
        console.log(`🚀 [Firebase] '${uid}' 손님의 메모 저장 성공! (ID: ${firebaseId})`);

        // [STEP 3 & 4] Notion 동시 저장 및 Notion ID 기록
        const notionPage = await saveToNotion(uid, receivedMemo, aiSummary, savedDate, firebaseId);
        await docRef.update({ notionPageId: notionPage.id });

        return res.status(200).json({ message: "메모가 'Firebase와 Notion'에 영구 저장되었습니다!" });

    } catch (dbError) {
        console.error('🔥 [Vercel] 저장 실패!', dbError);
        return res.status(500).json({ message: "서버에서 저장 중 오류 발생" });
    }
}