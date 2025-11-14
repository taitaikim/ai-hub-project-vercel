// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Zero-Error / 'JSON 파서' 제거)
// 경로: /api/memos/[id].js

import { db, auth, verifyToken, getAiSummary, updateNotionPage, deleteNotionPage } from '../../lib/ai-hub.js';

export default async function handler(req, res) {
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }
    const memoId = req.query.id;
    const uid = user.uid;

    // [수정] 'PUT' 요청 처리
    if (req.method === 'PUT') {
        
        // [수정!] 'JSON 번역기' ('수동' 파싱) '삭제!' (Vercel '자동' 파싱 사용)
        const requestBody = req.body;

        try {
            const newText = requestBody.text;
            
            // ... (이하 '수정' 로직 100% 동일) ...
            const docRef = db.collection('memos').doc(memoId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(404).send('문서를 찾을 수 없습니다.'); }
            if (doc.data().uid !== uid) { return res.status(403).send('수정 권한이 없습니다.'); }
            let newSummary = '';
            try { newSummary = await getAiSummary(newText); } 
            catch (aiError) { newSummary = "AI 재요약에 실패했습니다."; }
            await docRef.update({ text: newText, summary: newSummary });
            const notionPageId = doc.data().notionPageId;
            if (notionPageId) {
                await updateNotionPage(notionPageId, newText, newSummary);
            }
            return res.status(200).json({ message: "메모와 AI 요약이 성공적으로 수정되었습니다!" });

        } catch (error) {
            console.error('🔥 [Vercel] Firebase/Notion 수정 실패!', error);
            return res.status(500).json({ message: "서버에서 수정 중 오류 발생" });
        }
    }

    // [삭제] 'DELETE' 요청 처리 (기존과 동일)
    if (req.method === 'DELETE') {
        try {
            // ... (기존 '삭제' 로직 100% 동일) ...
            const docRef = db.collection('memos').doc(memoId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(404).send('문서를 찾을 수 없습니다.'); }
            if (doc.data().uid !== uid) { return res.status(403).send('삭제 권한이 없습니다.'); }
            await docRef.delete();
            const notionPageId = doc.data().notionPageId;
            if (notionPageId) {
                await deleteNotionPage(notionPageId);
            }
            return res.status(200).json({ message: "메모가 성공적으로 삭제되었습니다!" });
        } catch (error) {
            console.error('🔥 [Vercel] Firebase/Notion 삭제 실패!', error);
            return res.status(500).json({ message: "서버에서 삭제 중 오류 발생" });
        }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
}