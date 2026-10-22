/* Shared by the server and browser: group settings never change message delivery. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MessagePolicy = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
    const modes = ['all', 'important', 'none'];
    const mentioned = (message, userId) => (message.mentions || []).some(item => item.type === 'all' || item.userId === userId);
    function eligible(mode, message, userId) {
        if (!message || message.userId === userId || mode === 'none') return false;
        return mode !== 'important' || ['owner', 'admin'].includes(message.senderRole) || mentioned(message, userId);
    }
    function plainMentionAt(source, start, end) {
        // A completion entity ceases to be a mention if the user wraps it in code,
        // math or a link. The renderer also checks the actual parsed DOM.
        const islands = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|$)|\$\$[\s\S]*?(?:\$\$|$)|(?<!\\)\$(?:\\.|[^$\n])*(?:\$|$)|!?\[[^\]]*\]\([^\n)]*\)/g;
        let match;
        while ((match = islands.exec(source))) if (start < match.index + match[0].length && end > match.index) return false;
        return true;
    }
    return { modes, mentioned, eligible, plainMentionAt };
});
