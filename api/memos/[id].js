// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 2)
// 경로: /api/memos/[id].js
// (버그: 'import' 경로를 '../../'로 수정)

// --- 1. '중앙 통제실'에서 '부품' 가져오기 ---
// 
// [수정!] '../../../_lib/ai-hub.js' (X) 
// [수정!] '../../_lib/ai-hub.js' (O)
//
import {
    db,
    auth,
    verifyToken,
    getAiSummary,
    updateNotionPage,
    deleteNotionPage
} from '../../_lib/ai-hub.js';

// --- (이하 코드는 100% 동일) ---
export default async function handler(req, res) {
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }
    const memoId = req.query.id;
    const uid = user.uid;

    // [수정] 'PUT' 요청 처리
    if (req.method === 'PUT') {
        try {
            const newText = req.body.text;
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

    // [삭제] 'DELETE' 요청 처리
    if (req.method === 'DELETE') {
        try {
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