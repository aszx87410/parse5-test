"use strict";
exports.__esModule = true;
exports.Tokenizer = exports.TokenizerMode = void 0;
var preprocessor_js_1 = require("./preprocessor.js");
var unicode_js_1 = require("../common/unicode.js");
var token_js_1 = require("../common/token.js");
var decode_js_1 = require("entities/lib/decode.js");
var error_codes_js_1 = require("../common/error-codes.js");
var html_js_1 = require("../common/html.js");
//C1 Unicode control character reference replacements
var C1_CONTROLS_REFERENCE_REPLACEMENTS = new Map([
    [0x80, 8364],
    [0x82, 8218],
    [0x83, 402],
    [0x84, 8222],
    [0x85, 8230],
    [0x86, 8224],
    [0x87, 8225],
    [0x88, 710],
    [0x89, 8240],
    [0x8a, 352],
    [0x8b, 8249],
    [0x8c, 338],
    [0x8e, 381],
    [0x91, 8216],
    [0x92, 8217],
    [0x93, 8220],
    [0x94, 8221],
    [0x95, 8226],
    [0x96, 8211],
    [0x97, 8212],
    [0x98, 732],
    [0x99, 8482],
    [0x9a, 353],
    [0x9b, 8250],
    [0x9c, 339],
    [0x9e, 382],
    [0x9f, 376],
]);
//Tokenizer initial states for different modes
exports.TokenizerMode = {
    DATA: 0 /* State.DATA */,
    RCDATA: 1 /* State.RCDATA */,
    RAWTEXT: 2 /* State.RAWTEXT */,
    SCRIPT_DATA: 3 /* State.SCRIPT_DATA */,
    PLAINTEXT: 4 /* State.PLAINTEXT */,
    CDATA_SECTION: 68 /* State.CDATA_SECTION */
};
//Utils
//OPTIMIZATION: these utility functions should not be moved out of this module. V8 Crankshaft will not inline
//this functions if they will be situated in another module due to context switch.
//Always perform inlining check before modifying this functions ('node --trace-inlining').
function isAsciiDigit(cp) {
    return cp >= unicode_js_1.CODE_POINTS.DIGIT_0 && cp <= unicode_js_1.CODE_POINTS.DIGIT_9;
}
function isAsciiUpper(cp) {
    return cp >= unicode_js_1.CODE_POINTS.LATIN_CAPITAL_A && cp <= unicode_js_1.CODE_POINTS.LATIN_CAPITAL_Z;
}
function isAsciiLower(cp) {
    return cp >= unicode_js_1.CODE_POINTS.LATIN_SMALL_A && cp <= unicode_js_1.CODE_POINTS.LATIN_SMALL_Z;
}
function isAsciiLetter(cp) {
    return isAsciiLower(cp) || isAsciiUpper(cp);
}
function isAsciiAlphaNumeric(cp) {
    return isAsciiLetter(cp) || isAsciiDigit(cp);
}
function isAsciiUpperHexDigit(cp) {
    return cp >= unicode_js_1.CODE_POINTS.LATIN_CAPITAL_A && cp <= unicode_js_1.CODE_POINTS.LATIN_CAPITAL_F;
}
function isAsciiLowerHexDigit(cp) {
    return cp >= unicode_js_1.CODE_POINTS.LATIN_SMALL_A && cp <= unicode_js_1.CODE_POINTS.LATIN_SMALL_F;
}
function isAsciiHexDigit(cp) {
    return isAsciiDigit(cp) || isAsciiUpperHexDigit(cp) || isAsciiLowerHexDigit(cp);
}
function toAsciiLower(cp) {
    return cp + 32;
}
function isWhitespace(cp) {
    return cp === unicode_js_1.CODE_POINTS.SPACE || cp === unicode_js_1.CODE_POINTS.LINE_FEED || cp === unicode_js_1.CODE_POINTS.TABULATION || cp === unicode_js_1.CODE_POINTS.FORM_FEED;
}
function isEntityInAttributeInvalidEnd(nextCp) {
    return nextCp === unicode_js_1.CODE_POINTS.EQUALS_SIGN || isAsciiAlphaNumeric(nextCp);
}
function isScriptDataDoubleEscapeSequenceEnd(cp) {
    return isWhitespace(cp) || cp === unicode_js_1.CODE_POINTS.SOLIDUS || cp === unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN;
}
//Tokenizer
var Tokenizer = /** @class */ (function () {
    function Tokenizer(options, handler) {
        this.options = options;
        this.handler = handler;
        this.paused = false;
        /** Ensures that the parsing loop isn't run multiple times at once. */
        this.inLoop = false;
        /**
         * Indicates that the current adjusted node exists, is not an element in the HTML namespace,
         * and that it is not an integration point for either MathML or HTML.
         *
         * @see {@link https://html.spec.whatwg.org/multipage/parsing.html#tree-construction}
         */
        this.inForeignNode = false;
        this.lastStartTagName = '';
        this.active = false;
        this.state = 0 /* State.DATA */;
        this.returnState = 0 /* State.DATA */;
        this.charRefCode = -1;
        this.consumedAfterSnapshot = -1;
        this.currentCharacterToken = null;
        this.currentToken = null;
        this.currentAttr = { name: '', value: '' };
        this.preprocessor = new preprocessor_js_1.Preprocessor(handler);
        this.currentLocation = this.getCurrentLocation(-1);
    }
    //Errors
    Tokenizer.prototype._err = function (code) {
        var _a, _b;
        (_b = (_a = this.handler).onParseError) === null || _b === void 0 ? void 0 : _b.call(_a, this.preprocessor.getError(code));
    };
    // NOTE: `offset` may never run across line boundaries.
    Tokenizer.prototype.getCurrentLocation = function (offset) {
        if (!this.options.sourceCodeLocationInfo) {
            return null;
        }
        return {
            startLine: this.preprocessor.line,
            startCol: this.preprocessor.col - offset,
            startOffset: this.preprocessor.offset - offset,
            endLine: -1,
            endCol: -1,
            endOffset: -1
        };
    };
    Tokenizer.prototype._runParsingLoop = function () {
        if (this.inLoop)
            return;
        this.inLoop = true;
        while (this.active && !this.paused) {
            this.consumedAfterSnapshot = 0;
            var cp = this._consume();
            if (!this._ensureHibernation()) {
                this._callState(cp);
            }
        }
        this.inLoop = false;
    };
    //API
    Tokenizer.prototype.pause = function () {
        this.paused = true;
    };
    Tokenizer.prototype.resume = function (writeCallback) {
        if (!this.paused) {
            throw new Error('Parser was already resumed');
        }
        this.paused = false;
        // Necessary for synchronous resume.
        if (this.inLoop)
            return;
        this._runParsingLoop();
        if (!this.paused) {
            writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
        }
    };
    Tokenizer.prototype.write = function (chunk, isLastChunk, writeCallback) {
        this.active = true;
        this.preprocessor.write(chunk, isLastChunk);
        this._runParsingLoop();
        if (!this.paused) {
            writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
        }
    };
    Tokenizer.prototype.insertHtmlAtCurrentPos = function (chunk) {
        this.active = true;
        this.preprocessor.insertHtmlAtCurrentPos(chunk);
        this._runParsingLoop();
    };
    //Hibernation
    Tokenizer.prototype._ensureHibernation = function () {
        if (this.preprocessor.endOfChunkHit) {
            this._unconsume(this.consumedAfterSnapshot);
            this.active = false;
            return true;
        }
        return false;
    };
    //Consumption
    Tokenizer.prototype._consume = function () {
        this.consumedAfterSnapshot++;
        return this.preprocessor.advance();
    };
    Tokenizer.prototype._unconsume = function (count) {
        this.consumedAfterSnapshot -= count;
        this.preprocessor.retreat(count);
    };
    Tokenizer.prototype._reconsumeInState = function (state, cp) {
        this.state = state;
        this._callState(cp);
    };
    Tokenizer.prototype._advanceBy = function (count) {
        this.consumedAfterSnapshot += count;
        for (var i = 0; i < count; i++) {
            this.preprocessor.advance();
        }
    };
    Tokenizer.prototype._consumeSequenceIfMatch = function (pattern, caseSensitive) {
        if (this.preprocessor.startsWith(pattern, caseSensitive)) {
            // We will already have consumed one character before calling this method.
            this._advanceBy(pattern.length - 1);
            return true;
        }
        return false;
    };
    //Token creation
    Tokenizer.prototype._createStartTagToken = function () {
        this.currentToken = {
            type: token_js_1.TokenType.START_TAG,
            tagName: '',
            tagID: html_js_1.TAG_ID.UNKNOWN,
            selfClosing: false,
            ackSelfClosing: false,
            attrs: [],
            location: this.getCurrentLocation(1)
        };
    };
    Tokenizer.prototype._createEndTagToken = function () {
        this.currentToken = {
            type: token_js_1.TokenType.END_TAG,
            tagName: '',
            tagID: html_js_1.TAG_ID.UNKNOWN,
            selfClosing: false,
            ackSelfClosing: false,
            attrs: [],
            location: this.getCurrentLocation(2)
        };
    };
    Tokenizer.prototype._createCommentToken = function (offset) {
        this.currentToken = {
            type: token_js_1.TokenType.COMMENT,
            data: '',
            location: this.getCurrentLocation(offset)
        };
    };
    Tokenizer.prototype._createDoctypeToken = function (initialName) {
        this.currentToken = {
            type: token_js_1.TokenType.DOCTYPE,
            name: initialName,
            forceQuirks: false,
            publicId: null,
            systemId: null,
            location: this.currentLocation
        };
    };
    Tokenizer.prototype._createCharacterToken = function (type, chars) {
        this.currentCharacterToken = {
            type: type,
            chars: chars,
            location: this.currentLocation
        };
    };
    //Tag attributes
    Tokenizer.prototype._createAttr = function (attrNameFirstCh) {
        this.currentAttr = {
            name: attrNameFirstCh,
            value: ''
        };
        this.currentLocation = this.getCurrentLocation(0);
    };
    Tokenizer.prototype._leaveAttrName = function () {
        var _a;
        var _b;
        var token = this.currentToken;
        if ((0, token_js_1.getTokenAttr)(token, this.currentAttr.name) === null) {
            token.attrs.push(this.currentAttr);
            if (token.location && this.currentLocation) {
                var attrLocations = ((_a = (_b = token.location).attrs) !== null && _a !== void 0 ? _a : (_b.attrs = Object.create(null)));
                attrLocations[this.currentAttr.name] = this.currentLocation;
                // Set end location
                this._leaveAttrValue();
            }
        }
        else {
            this._err(error_codes_js_1.ERR.duplicateAttribute);
        }
    };
    Tokenizer.prototype._leaveAttrValue = function () {
        if (this.currentLocation) {
            this.currentLocation.endLine = this.preprocessor.line;
            this.currentLocation.endCol = this.preprocessor.col;
            this.currentLocation.endOffset = this.preprocessor.offset;
        }
    };
    //Token emission
    Tokenizer.prototype.prepareToken = function (ct) {
        this._emitCurrentCharacterToken(ct.location);
        this.currentToken = null;
        if (ct.location) {
            ct.location.endLine = this.preprocessor.line;
            ct.location.endCol = this.preprocessor.col + 1;
            ct.location.endOffset = this.preprocessor.offset + 1;
        }
        this.currentLocation = this.getCurrentLocation(-1);
    };
    Tokenizer.prototype.emitCurrentTagToken = function () {
        var ct = this.currentToken;
        this.prepareToken(ct);
        ct.tagID = (0, html_js_1.getTagID)(ct.tagName);
        if (ct.type === token_js_1.TokenType.START_TAG) {
            this.lastStartTagName = ct.tagName;
            this.handler.onStartTag(ct);
        }
        else {
            if (ct.attrs.length > 0) {
                this._err(error_codes_js_1.ERR.endTagWithAttributes);
            }
            if (ct.selfClosing) {
                this._err(error_codes_js_1.ERR.endTagWithTrailingSolidus);
            }
            this.handler.onEndTag(ct);
        }
        this.preprocessor.dropParsedChunk();
    };
    Tokenizer.prototype.emitCurrentComment = function (ct) {
        this.prepareToken(ct);
        this.handler.onComment(ct);
        this.preprocessor.dropParsedChunk();
    };
    Tokenizer.prototype.emitCurrentDoctype = function (ct) {
        this.prepareToken(ct);
        this.handler.onDoctype(ct);
        this.preprocessor.dropParsedChunk();
    };
    Tokenizer.prototype._emitCurrentCharacterToken = function (nextLocation) {
        if (this.currentCharacterToken) {
            //NOTE: if we have a pending character token, make it's end location equal to the
            //current token's start location.
            if (nextLocation && this.currentCharacterToken.location) {
                this.currentCharacterToken.location.endLine = nextLocation.startLine;
                this.currentCharacterToken.location.endCol = nextLocation.startCol;
                this.currentCharacterToken.location.endOffset = nextLocation.startOffset;
            }
            switch (this.currentCharacterToken.type) {
                case token_js_1.TokenType.CHARACTER: {
                    this.handler.onCharacter(this.currentCharacterToken);
                    break;
                }
                case token_js_1.TokenType.NULL_CHARACTER: {
                    this.handler.onNullCharacter(this.currentCharacterToken);
                    break;
                }
                case token_js_1.TokenType.WHITESPACE_CHARACTER: {
                    this.handler.onWhitespaceCharacter(this.currentCharacterToken);
                    break;
                }
            }
            this.currentCharacterToken = null;
        }
    };
    Tokenizer.prototype._emitEOFToken = function () {
        var location = this.getCurrentLocation(0);
        if (location) {
            location.endLine = location.startLine;
            location.endCol = location.startCol;
            location.endOffset = location.startOffset;
        }
        this._emitCurrentCharacterToken(location);
        this.handler.onEof({ type: token_js_1.TokenType.EOF, location: location });
        this.active = false;
    };
    //Characters emission
    //OPTIMIZATION: specification uses only one type of character tokens (one token per character).
    //This causes a huge memory overhead and a lot of unnecessary parser loops. parse5 uses 3 groups of characters.
    //If we have a sequence of characters that belong to the same group, the parser can process it
    //as a single solid character token.
    //So, there are 3 types of character tokens in parse5:
    //1)TokenType.NULL_CHARACTER - \u0000-character sequences (e.g. '\u0000\u0000\u0000')
    //2)TokenType.WHITESPACE_CHARACTER - any whitespace/new-line character sequences (e.g. '\n  \r\t   \f')
    //3)TokenType.CHARACTER - any character sequence which don't belong to groups 1 and 2 (e.g. 'abcdef1234@@#$%^')
    Tokenizer.prototype._appendCharToCurrentCharacterToken = function (type, ch) {
        if (this.currentCharacterToken) {
            if (this.currentCharacterToken.type !== type) {
                this.currentLocation = this.getCurrentLocation(0);
                this._emitCurrentCharacterToken(this.currentLocation);
                this.preprocessor.dropParsedChunk();
            }
            else {
                this.currentCharacterToken.chars += ch;
                return;
            }
        }
        this._createCharacterToken(type, ch);
    };
    Tokenizer.prototype._emitCodePoint = function (cp) {
        var type = isWhitespace(cp)
            ? token_js_1.TokenType.WHITESPACE_CHARACTER
            : cp === unicode_js_1.CODE_POINTS.NULL
                ? token_js_1.TokenType.NULL_CHARACTER
                : token_js_1.TokenType.CHARACTER;
        this._appendCharToCurrentCharacterToken(type, String.fromCodePoint(cp));
    };
    //NOTE: used when we emit characters explicitly.
    //This is always for non-whitespace and non-null characters, which allows us to avoid additional checks.
    Tokenizer.prototype._emitChars = function (ch) {
        this._appendCharToCurrentCharacterToken(token_js_1.TokenType.CHARACTER, ch);
    };
    // Character reference helpers
    Tokenizer.prototype._matchNamedCharacterReference = function (cp) {
        var result = null;
        var excess = 0;
        var withoutSemicolon = false;
        for (var i = 0, current = decode_js_1.htmlDecodeTree[0]; i >= 0; cp = this._consume()) {
            i = (0, decode_js_1.determineBranch)(decode_js_1.htmlDecodeTree, current, i + 1, cp);
            if (i < 0)
                break;
            excess += 1;
            current = decode_js_1.htmlDecodeTree[i];
            var masked = current & decode_js_1.BinTrieFlags.VALUE_LENGTH;
            // If the branch is a value, store it and continue
            if (masked) {
                // The mask is the number of bytes of the value, including the current byte.
                var valueLength = (masked >> 14) - 1;
                // Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
                // See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
                if (cp !== unicode_js_1.CODE_POINTS.SEMICOLON &&
                    this._isCharacterReferenceInAttribute() &&
                    isEntityInAttributeInvalidEnd(this.preprocessor.peek(1))) {
                    //NOTE: we don't flush all consumed code points here, and instead switch back to the original state after
                    //emitting an ampersand. This is fine, as alphanumeric characters won't be parsed differently in attributes.
                    result = [unicode_js_1.CODE_POINTS.AMPERSAND];
                    // Skip over the value.
                    i += valueLength;
                }
                else {
                    // If this is a surrogate pair, consume the next two bytes.
                    result =
                        valueLength === 0
                            ? [decode_js_1.htmlDecodeTree[i] & ~decode_js_1.BinTrieFlags.VALUE_LENGTH]
                            : valueLength === 1
                                ? [decode_js_1.htmlDecodeTree[++i]]
                                : [decode_js_1.htmlDecodeTree[++i], decode_js_1.htmlDecodeTree[++i]];
                    excess = 0;
                    withoutSemicolon = cp !== unicode_js_1.CODE_POINTS.SEMICOLON;
                }
                if (valueLength === 0) {
                    // If the value is zero-length, we're done.
                    this._consume();
                    break;
                }
            }
        }
        this._unconsume(excess);
        if (withoutSemicolon && !this.preprocessor.endOfChunkHit) {
            this._err(error_codes_js_1.ERR.missingSemicolonAfterCharacterReference);
        }
        // We want to emit the error above on the code point after the entity.
        // We always consume one code point too many in the loop, and we wait to
        // unconsume it until after the error is emitted.
        this._unconsume(1);
        return result;
    };
    Tokenizer.prototype._isCharacterReferenceInAttribute = function () {
        return (this.returnState === 35 /* State.ATTRIBUTE_VALUE_DOUBLE_QUOTED */ ||
            this.returnState === 36 /* State.ATTRIBUTE_VALUE_SINGLE_QUOTED */ ||
            this.returnState === 37 /* State.ATTRIBUTE_VALUE_UNQUOTED */);
    };
    Tokenizer.prototype._flushCodePointConsumedAsCharacterReference = function (cp) {
        if (this._isCharacterReferenceInAttribute()) {
            this.currentAttr.value += String.fromCodePoint(cp);
        }
        else {
            this._emitCodePoint(cp);
        }
    };
    // Calling states this way turns out to be much faster than any other approach.
    Tokenizer.prototype._callState = function (cp) {
        switch (this.state) {
            case 0 /* State.DATA */: {
                this._stateData(cp);
                break;
            }
            case 1 /* State.RCDATA */: {
                this._stateRcdata(cp);
                break;
            }
            case 2 /* State.RAWTEXT */: {
                this._stateRawtext(cp);
                break;
            }
            case 3 /* State.SCRIPT_DATA */: {
                this._stateScriptData(cp);
                break;
            }
            case 4 /* State.PLAINTEXT */: {
                this._statePlaintext(cp);
                break;
            }
            case 5 /* State.TAG_OPEN */: {
                this._stateTagOpen(cp);
                break;
            }
            case 6 /* State.END_TAG_OPEN */: {
                this._stateEndTagOpen(cp);
                break;
            }
            case 7 /* State.TAG_NAME */: {
                this._stateTagName(cp);
                break;
            }
            case 8 /* State.RCDATA_LESS_THAN_SIGN */: {
                this._stateRcdataLessThanSign(cp);
                break;
            }
            case 9 /* State.RCDATA_END_TAG_OPEN */: {
                this._stateRcdataEndTagOpen(cp);
                break;
            }
            case 10 /* State.RCDATA_END_TAG_NAME */: {
                this._stateRcdataEndTagName(cp);
                break;
            }
            case 11 /* State.RAWTEXT_LESS_THAN_SIGN */: {
                this._stateRawtextLessThanSign(cp);
                break;
            }
            case 12 /* State.RAWTEXT_END_TAG_OPEN */: {
                this._stateRawtextEndTagOpen(cp);
                break;
            }
            case 13 /* State.RAWTEXT_END_TAG_NAME */: {
                this._stateRawtextEndTagName(cp);
                break;
            }
            case 14 /* State.SCRIPT_DATA_LESS_THAN_SIGN */: {
                this._stateScriptDataLessThanSign(cp);
                break;
            }
            case 15 /* State.SCRIPT_DATA_END_TAG_OPEN */: {
                this._stateScriptDataEndTagOpen(cp);
                break;
            }
            case 16 /* State.SCRIPT_DATA_END_TAG_NAME */: {
                this._stateScriptDataEndTagName(cp);
                break;
            }
            case 17 /* State.SCRIPT_DATA_ESCAPE_START */: {
                this._stateScriptDataEscapeStart(cp);
                break;
            }
            case 18 /* State.SCRIPT_DATA_ESCAPE_START_DASH */: {
                this._stateScriptDataEscapeStartDash(cp);
                break;
            }
            case 19 /* State.SCRIPT_DATA_ESCAPED */: {
                this._stateScriptDataEscaped(cp);
                break;
            }
            case 20 /* State.SCRIPT_DATA_ESCAPED_DASH */: {
                this._stateScriptDataEscapedDash(cp);
                break;
            }
            case 21 /* State.SCRIPT_DATA_ESCAPED_DASH_DASH */: {
                this._stateScriptDataEscapedDashDash(cp);
                break;
            }
            case 22 /* State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN */: {
                this._stateScriptDataEscapedLessThanSign(cp);
                break;
            }
            case 23 /* State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN */: {
                this._stateScriptDataEscapedEndTagOpen(cp);
                break;
            }
            case 24 /* State.SCRIPT_DATA_ESCAPED_END_TAG_NAME */: {
                this._stateScriptDataEscapedEndTagName(cp);
                break;
            }
            case 25 /* State.SCRIPT_DATA_DOUBLE_ESCAPE_START */: {
                this._stateScriptDataDoubleEscapeStart(cp);
                break;
            }
            case 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */: {
                this._stateScriptDataDoubleEscaped(cp);
                break;
            }
            case 27 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH */: {
                this._stateScriptDataDoubleEscapedDash(cp);
                break;
            }
            case 28 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH */: {
                this._stateScriptDataDoubleEscapedDashDash(cp);
                break;
            }
            case 29 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN */: {
                this._stateScriptDataDoubleEscapedLessThanSign(cp);
                break;
            }
            case 30 /* State.SCRIPT_DATA_DOUBLE_ESCAPE_END */: {
                this._stateScriptDataDoubleEscapeEnd(cp);
                break;
            }
            case 31 /* State.BEFORE_ATTRIBUTE_NAME */: {
                this._stateBeforeAttributeName(cp);
                break;
            }
            case 32 /* State.ATTRIBUTE_NAME */: {
                this._stateAttributeName(cp);
                break;
            }
            case 33 /* State.AFTER_ATTRIBUTE_NAME */: {
                this._stateAfterAttributeName(cp);
                break;
            }
            case 34 /* State.BEFORE_ATTRIBUTE_VALUE */: {
                this._stateBeforeAttributeValue(cp);
                break;
            }
            case 35 /* State.ATTRIBUTE_VALUE_DOUBLE_QUOTED */: {
                this._stateAttributeValueDoubleQuoted(cp);
                break;
            }
            case 36 /* State.ATTRIBUTE_VALUE_SINGLE_QUOTED */: {
                this._stateAttributeValueSingleQuoted(cp);
                break;
            }
            case 37 /* State.ATTRIBUTE_VALUE_UNQUOTED */: {
                this._stateAttributeValueUnquoted(cp);
                break;
            }
            case 38 /* State.AFTER_ATTRIBUTE_VALUE_QUOTED */: {
                this._stateAfterAttributeValueQuoted(cp);
                break;
            }
            case 39 /* State.SELF_CLOSING_START_TAG */: {
                this._stateSelfClosingStartTag(cp);
                break;
            }
            case 40 /* State.BOGUS_COMMENT */: {
                this._stateBogusComment(cp);
                break;
            }
            case 41 /* State.MARKUP_DECLARATION_OPEN */: {
                this._stateMarkupDeclarationOpen(cp);
                break;
            }
            case 42 /* State.COMMENT_START */: {
                this._stateCommentStart(cp);
                break;
            }
            case 43 /* State.COMMENT_START_DASH */: {
                this._stateCommentStartDash(cp);
                break;
            }
            case 44 /* State.COMMENT */: {
                this._stateComment(cp);
                break;
            }
            case 45 /* State.COMMENT_LESS_THAN_SIGN */: {
                this._stateCommentLessThanSign(cp);
                break;
            }
            case 46 /* State.COMMENT_LESS_THAN_SIGN_BANG */: {
                this._stateCommentLessThanSignBang(cp);
                break;
            }
            case 47 /* State.COMMENT_LESS_THAN_SIGN_BANG_DASH */: {
                this._stateCommentLessThanSignBangDash(cp);
                break;
            }
            case 48 /* State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH */: {
                this._stateCommentLessThanSignBangDashDash(cp);
                break;
            }
            case 49 /* State.COMMENT_END_DASH */: {
                this._stateCommentEndDash(cp);
                break;
            }
            case 50 /* State.COMMENT_END */: {
                this._stateCommentEnd(cp);
                break;
            }
            case 51 /* State.COMMENT_END_BANG */: {
                this._stateCommentEndBang(cp);
                break;
            }
            case 52 /* State.DOCTYPE */: {
                this._stateDoctype(cp);
                break;
            }
            case 53 /* State.BEFORE_DOCTYPE_NAME */: {
                this._stateBeforeDoctypeName(cp);
                break;
            }
            case 54 /* State.DOCTYPE_NAME */: {
                this._stateDoctypeName(cp);
                break;
            }
            case 55 /* State.AFTER_DOCTYPE_NAME */: {
                this._stateAfterDoctypeName(cp);
                break;
            }
            case 56 /* State.AFTER_DOCTYPE_PUBLIC_KEYWORD */: {
                this._stateAfterDoctypePublicKeyword(cp);
                break;
            }
            case 57 /* State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER */: {
                this._stateBeforeDoctypePublicIdentifier(cp);
                break;
            }
            case 58 /* State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED */: {
                this._stateDoctypePublicIdentifierDoubleQuoted(cp);
                break;
            }
            case 59 /* State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED */: {
                this._stateDoctypePublicIdentifierSingleQuoted(cp);
                break;
            }
            case 60 /* State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER */: {
                this._stateAfterDoctypePublicIdentifier(cp);
                break;
            }
            case 61 /* State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS */: {
                this._stateBetweenDoctypePublicAndSystemIdentifiers(cp);
                break;
            }
            case 62 /* State.AFTER_DOCTYPE_SYSTEM_KEYWORD */: {
                this._stateAfterDoctypeSystemKeyword(cp);
                break;
            }
            case 63 /* State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER */: {
                this._stateBeforeDoctypeSystemIdentifier(cp);
                break;
            }
            case 64 /* State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */: {
                this._stateDoctypeSystemIdentifierDoubleQuoted(cp);
                break;
            }
            case 65 /* State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */: {
                this._stateDoctypeSystemIdentifierSingleQuoted(cp);
                break;
            }
            case 66 /* State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER */: {
                this._stateAfterDoctypeSystemIdentifier(cp);
                break;
            }
            case 67 /* State.BOGUS_DOCTYPE */: {
                this._stateBogusDoctype(cp);
                break;
            }
            case 68 /* State.CDATA_SECTION */: {
                this._stateCdataSection(cp);
                break;
            }
            case 69 /* State.CDATA_SECTION_BRACKET */: {
                this._stateCdataSectionBracket(cp);
                break;
            }
            case 70 /* State.CDATA_SECTION_END */: {
                this._stateCdataSectionEnd(cp);
                break;
            }
            case 71 /* State.CHARACTER_REFERENCE */: {
                this._stateCharacterReference(cp);
                break;
            }
            case 72 /* State.NAMED_CHARACTER_REFERENCE */: {
                this._stateNamedCharacterReference(cp);
                break;
            }
            case 73 /* State.AMBIGUOUS_AMPERSAND */: {
                this._stateAmbiguousAmpersand(cp);
                break;
            }
            case 74 /* State.NUMERIC_CHARACTER_REFERENCE */: {
                this._stateNumericCharacterReference(cp);
                break;
            }
            case 75 /* State.HEXADEMICAL_CHARACTER_REFERENCE_START */: {
                this._stateHexademicalCharacterReferenceStart(cp);
                break;
            }
            case 76 /* State.HEXADEMICAL_CHARACTER_REFERENCE */: {
                this._stateHexademicalCharacterReference(cp);
                break;
            }
            case 77 /* State.DECIMAL_CHARACTER_REFERENCE */: {
                this._stateDecimalCharacterReference(cp);
                break;
            }
            case 78 /* State.NUMERIC_CHARACTER_REFERENCE_END */: {
                this._stateNumericCharacterReferenceEnd(cp);
                break;
            }
            default: {
                throw new Error('Unknown state');
            }
        }
    };
    // State machine
    // Data state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateData = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 5 /* State.TAG_OPEN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.AMPERSAND: {
                this.returnState = 0 /* State.DATA */;
                this.state = 71 /* State.CHARACTER_REFERENCE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitCodePoint(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    //  RCDATA state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRcdata = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.AMPERSAND: {
                this.returnState = 1 /* State.RCDATA */;
                this.state = 71 /* State.CHARACTER_REFERENCE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 8 /* State.RCDATA_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // RAWTEXT state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRawtext = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 11 /* State.RAWTEXT_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptData = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 14 /* State.SCRIPT_DATA_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // PLAINTEXT state
    //------------------------------------------------------------------
    Tokenizer.prototype._statePlaintext = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // Tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this._createStartTagToken();
            this.state = 7 /* State.TAG_NAME */;
            this._stateTagName(cp);
        }
        else
            switch (cp) {
                case unicode_js_1.CODE_POINTS.EXCLAMATION_MARK: {
                    this.state = 41 /* State.MARKUP_DECLARATION_OPEN */;
                    break;
                }
                case unicode_js_1.CODE_POINTS.SOLIDUS: {
                    this.state = 6 /* State.END_TAG_OPEN */;
                    break;
                }
                case unicode_js_1.CODE_POINTS.QUESTION_MARK: {
                    this._err(error_codes_js_1.ERR.unexpectedQuestionMarkInsteadOfTagName);
                    this._createCommentToken(1);
                    this.state = 40 /* State.BOGUS_COMMENT */;
                    this._stateBogusComment(cp);
                    break;
                }
                case unicode_js_1.CODE_POINTS.EOF: {
                    this._err(error_codes_js_1.ERR.eofBeforeTagName);
                    this._emitChars('<');
                    this._emitEOFToken();
                    break;
                }
                default: {
                    this._err(error_codes_js_1.ERR.invalidFirstCharacterOfTagName);
                    this._emitChars('<');
                    this.state = 0 /* State.DATA */;
                    this._stateData(cp);
                }
            }
    };
    // End tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateEndTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this._createEndTagToken();
            this.state = 7 /* State.TAG_NAME */;
            this._stateTagName(cp);
        }
        else
            switch (cp) {
                case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                    this._err(error_codes_js_1.ERR.missingEndTagName);
                    this.state = 0 /* State.DATA */;
                    break;
                }
                case unicode_js_1.CODE_POINTS.EOF: {
                    this._err(error_codes_js_1.ERR.eofBeforeTagName);
                    this._emitChars('</');
                    this._emitEOFToken();
                    break;
                }
                default: {
                    this._err(error_codes_js_1.ERR.invalidFirstCharacterOfTagName);
                    this._createCommentToken(2);
                    this.state = 40 /* State.BOGUS_COMMENT */;
                    this._stateBogusComment(cp);
                }
            }
    };
    // Tag name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateTagName = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                break;
            }
            case unicode_js_1.CODE_POINTS.SOLIDUS: {
                this.state = 39 /* State.SELF_CLOSING_START_TAG */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.tagName += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                token.tagName += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
            }
        }
    };
    // RCDATA less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRcdataLessThanSign = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.SOLIDUS) {
            this.state = 9 /* State.RCDATA_END_TAG_OPEN */;
        }
        else {
            this._emitChars('<');
            this.state = 1 /* State.RCDATA */;
            this._stateRcdata(cp);
        }
    };
    // RCDATA end tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRcdataEndTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this.state = 10 /* State.RCDATA_END_TAG_NAME */;
            this._stateRcdataEndTagName(cp);
        }
        else {
            this._emitChars('</');
            this.state = 1 /* State.RCDATA */;
            this._stateRcdata(cp);
        }
    };
    Tokenizer.prototype.handleSpecialEndTag = function (_cp) {
        if (!this.preprocessor.startsWith(this.lastStartTagName, false)) {
            return !this._ensureHibernation();
        }
        this._createEndTagToken();
        var token = this.currentToken;
        token.tagName = this.lastStartTagName;
        var cp = this.preprocessor.peek(this.lastStartTagName.length);
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this._advanceBy(this.lastStartTagName.length);
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                return false;
            }
            case unicode_js_1.CODE_POINTS.SOLIDUS: {
                this._advanceBy(this.lastStartTagName.length);
                this.state = 39 /* State.SELF_CLOSING_START_TAG */;
                return false;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._advanceBy(this.lastStartTagName.length);
                this.emitCurrentTagToken();
                this.state = 0 /* State.DATA */;
                return false;
            }
            default: {
                return !this._ensureHibernation();
            }
        }
    };
    // RCDATA end tag name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRcdataEndTagName = function (cp) {
        if (this.handleSpecialEndTag(cp)) {
            this._emitChars('</');
            this.state = 1 /* State.RCDATA */;
            this._stateRcdata(cp);
        }
    };
    // RAWTEXT less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRawtextLessThanSign = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.SOLIDUS) {
            this.state = 12 /* State.RAWTEXT_END_TAG_OPEN */;
        }
        else {
            this._emitChars('<');
            this.state = 2 /* State.RAWTEXT */;
            this._stateRawtext(cp);
        }
    };
    // RAWTEXT end tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRawtextEndTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this.state = 13 /* State.RAWTEXT_END_TAG_NAME */;
            this._stateRawtextEndTagName(cp);
        }
        else {
            this._emitChars('</');
            this.state = 2 /* State.RAWTEXT */;
            this._stateRawtext(cp);
        }
    };
    // RAWTEXT end tag name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateRawtextEndTagName = function (cp) {
        if (this.handleSpecialEndTag(cp)) {
            this._emitChars('</');
            this.state = 2 /* State.RAWTEXT */;
            this._stateRawtext(cp);
        }
    };
    // Script data less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataLessThanSign = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SOLIDUS: {
                this.state = 15 /* State.SCRIPT_DATA_END_TAG_OPEN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EXCLAMATION_MARK: {
                this.state = 17 /* State.SCRIPT_DATA_ESCAPE_START */;
                this._emitChars('<!');
                break;
            }
            default: {
                this._emitChars('<');
                this.state = 3 /* State.SCRIPT_DATA */;
                this._stateScriptData(cp);
            }
        }
    };
    // Script data end tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEndTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this.state = 16 /* State.SCRIPT_DATA_END_TAG_NAME */;
            this._stateScriptDataEndTagName(cp);
        }
        else {
            this._emitChars('</');
            this.state = 3 /* State.SCRIPT_DATA */;
            this._stateScriptData(cp);
        }
    };
    // Script data end tag name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEndTagName = function (cp) {
        if (this.handleSpecialEndTag(cp)) {
            this._emitChars('</');
            this.state = 3 /* State.SCRIPT_DATA */;
            this._stateScriptData(cp);
        }
    };
    // Script data escape start state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapeStart = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.HYPHEN_MINUS) {
            this.state = 18 /* State.SCRIPT_DATA_ESCAPE_START_DASH */;
            this._emitChars('-');
        }
        else {
            this.state = 3 /* State.SCRIPT_DATA */;
            this._stateScriptData(cp);
        }
    };
    // Script data escape start dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapeStartDash = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.HYPHEN_MINUS) {
            this.state = 21 /* State.SCRIPT_DATA_ESCAPED_DASH_DASH */;
            this._emitChars('-');
        }
        else {
            this.state = 3 /* State.SCRIPT_DATA */;
            this._stateScriptData(cp);
        }
    };
    // Script data escaped state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscaped = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 20 /* State.SCRIPT_DATA_ESCAPED_DASH */;
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 22 /* State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data escaped dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapedDash = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 21 /* State.SCRIPT_DATA_ESCAPED_DASH_DASH */;
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 22 /* State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data escaped dash dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapedDashDash = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 22 /* State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 3 /* State.SCRIPT_DATA */;
                this._emitChars('>');
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data escaped less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapedLessThanSign = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.SOLIDUS) {
            this.state = 23 /* State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN */;
        }
        else if (isAsciiLetter(cp)) {
            this._emitChars('<');
            this.state = 25 /* State.SCRIPT_DATA_DOUBLE_ESCAPE_START */;
            this._stateScriptDataDoubleEscapeStart(cp);
        }
        else {
            this._emitChars('<');
            this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
            this._stateScriptDataEscaped(cp);
        }
    };
    // Script data escaped end tag open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapedEndTagOpen = function (cp) {
        if (isAsciiLetter(cp)) {
            this.state = 24 /* State.SCRIPT_DATA_ESCAPED_END_TAG_NAME */;
            this._stateScriptDataEscapedEndTagName(cp);
        }
        else {
            this._emitChars('</');
            this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
            this._stateScriptDataEscaped(cp);
        }
    };
    // Script data escaped end tag name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataEscapedEndTagName = function (cp) {
        if (this.handleSpecialEndTag(cp)) {
            this._emitChars('</');
            this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
            this._stateScriptDataEscaped(cp);
        }
    };
    // Script data double escape start state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscapeStart = function (cp) {
        if (this.preprocessor.startsWith(unicode_js_1.SEQUENCES.SCRIPT, false) &&
            isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(unicode_js_1.SEQUENCES.SCRIPT.length))) {
            this._emitCodePoint(cp);
            for (var i = 0; i < unicode_js_1.SEQUENCES.SCRIPT.length; i++) {
                this._emitCodePoint(this._consume());
            }
            this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
        }
        else if (!this._ensureHibernation()) {
            this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
            this._stateScriptDataEscaped(cp);
        }
    };
    // Script data double escaped state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscaped = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 27 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH */;
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 29 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN */;
                this._emitChars('<');
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data double escaped dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscapedDash = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 28 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH */;
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 29 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN */;
                this._emitChars('<');
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data double escaped dash dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscapedDashDash = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this._emitChars('-');
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this.state = 29 /* State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN */;
                this._emitChars('<');
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 3 /* State.SCRIPT_DATA */;
                this._emitChars('>');
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
                this._emitChars(unicode_js_1.REPLACEMENT_CHARACTER);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInScriptHtmlCommentLikeText);
                this._emitEOFToken();
                break;
            }
            default: {
                this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
                this._emitCodePoint(cp);
            }
        }
    };
    // Script data double escaped less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscapedLessThanSign = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.SOLIDUS) {
            this.state = 30 /* State.SCRIPT_DATA_DOUBLE_ESCAPE_END */;
            this._emitChars('/');
        }
        else {
            this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
            this._stateScriptDataDoubleEscaped(cp);
        }
    };
    // Script data double escape end state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateScriptDataDoubleEscapeEnd = function (cp) {
        if (this.preprocessor.startsWith(unicode_js_1.SEQUENCES.SCRIPT, false) &&
            isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(unicode_js_1.SEQUENCES.SCRIPT.length))) {
            this._emitCodePoint(cp);
            for (var i = 0; i < unicode_js_1.SEQUENCES.SCRIPT.length; i++) {
                this._emitCodePoint(this._consume());
            }
            this.state = 19 /* State.SCRIPT_DATA_ESCAPED */;
        }
        else if (!this._ensureHibernation()) {
            this.state = 26 /* State.SCRIPT_DATA_DOUBLE_ESCAPED */;
            this._stateScriptDataDoubleEscaped(cp);
        }
    };
    // Before attribute name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBeforeAttributeName = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.SOLIDUS:
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN:
            case unicode_js_1.CODE_POINTS.EOF: {
                this.state = 33 /* State.AFTER_ATTRIBUTE_NAME */;
                this._stateAfterAttributeName(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.EQUALS_SIGN: {
                this._err(error_codes_js_1.ERR.unexpectedEqualsSignBeforeAttributeName);
                this._createAttr('=');
                this.state = 32 /* State.ATTRIBUTE_NAME */;
                break;
            }
            default: {
                this._createAttr('');
                this.state = 32 /* State.ATTRIBUTE_NAME */;
                this._stateAttributeName(cp);
            }
        }
    };
    // Attribute name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAttributeName = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED:
            case unicode_js_1.CODE_POINTS.SOLIDUS:
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN:
            case unicode_js_1.CODE_POINTS.EOF: {
                this._leaveAttrName();
                this.state = 33 /* State.AFTER_ATTRIBUTE_NAME */;
                this._stateAfterAttributeName(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.EQUALS_SIGN: {
                this._leaveAttrName();
                this.state = 34 /* State.BEFORE_ATTRIBUTE_VALUE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK:
            case unicode_js_1.CODE_POINTS.APOSTROPHE:
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.unexpectedCharacterInAttributeName);
                this.currentAttr.name += String.fromCodePoint(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.currentAttr.name += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            default: {
                this.currentAttr.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
            }
        }
    };
    // After attribute name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterAttributeName = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.SOLIDUS: {
                this.state = 39 /* State.SELF_CLOSING_START_TAG */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EQUALS_SIGN: {
                this.state = 34 /* State.BEFORE_ATTRIBUTE_VALUE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this._createAttr('');
                this.state = 32 /* State.ATTRIBUTE_NAME */;
                this._stateAttributeName(cp);
            }
        }
    };
    // Before attribute value state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBeforeAttributeValue = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this.state = 35 /* State.ATTRIBUTE_VALUE_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this.state = 36 /* State.ATTRIBUTE_VALUE_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.missingAttributeValue);
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            default: {
                this.state = 37 /* State.ATTRIBUTE_VALUE_UNQUOTED */;
                this._stateAttributeValueUnquoted(cp);
            }
        }
    };
    // Attribute value (double-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAttributeValueDoubleQuoted = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this.state = 38 /* State.AFTER_ATTRIBUTE_VALUE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.AMPERSAND: {
                this.returnState = 35 /* State.ATTRIBUTE_VALUE_DOUBLE_QUOTED */;
                this.state = 71 /* State.CHARACTER_REFERENCE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.currentAttr.value += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this.currentAttr.value += String.fromCodePoint(cp);
            }
        }
    };
    // Attribute value (single-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAttributeValueSingleQuoted = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this.state = 38 /* State.AFTER_ATTRIBUTE_VALUE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.AMPERSAND: {
                this.returnState = 36 /* State.ATTRIBUTE_VALUE_SINGLE_QUOTED */;
                this.state = 71 /* State.CHARACTER_REFERENCE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.currentAttr.value += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this.currentAttr.value += String.fromCodePoint(cp);
            }
        }
    };
    // Attribute value (unquoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAttributeValueUnquoted = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this._leaveAttrValue();
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                break;
            }
            case unicode_js_1.CODE_POINTS.AMPERSAND: {
                this.returnState = 37 /* State.ATTRIBUTE_VALUE_UNQUOTED */;
                this.state = 71 /* State.CHARACTER_REFERENCE */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._leaveAttrValue();
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                this.currentAttr.value += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK:
            case unicode_js_1.CODE_POINTS.APOSTROPHE:
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN:
            case unicode_js_1.CODE_POINTS.EQUALS_SIGN:
            case unicode_js_1.CODE_POINTS.GRAVE_ACCENT: {
                this._err(error_codes_js_1.ERR.unexpectedCharacterInUnquotedAttributeValue);
                this.currentAttr.value += String.fromCodePoint(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this.currentAttr.value += String.fromCodePoint(cp);
            }
        }
    };
    // After attribute value (quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterAttributeValueQuoted = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this._leaveAttrValue();
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                break;
            }
            case unicode_js_1.CODE_POINTS.SOLIDUS: {
                this._leaveAttrValue();
                this.state = 39 /* State.SELF_CLOSING_START_TAG */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._leaveAttrValue();
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingWhitespaceBetweenAttributes);
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                this._stateBeforeAttributeName(cp);
            }
        }
    };
    // Self-closing start tag state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateSelfClosingStartTag = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                var token = this.currentToken;
                token.selfClosing = true;
                this.state = 0 /* State.DATA */;
                this.emitCurrentTagToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInTag);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.unexpectedSolidusInTag);
                this.state = 31 /* State.BEFORE_ATTRIBUTE_NAME */;
                this._stateBeforeAttributeName(cp);
            }
        }
    };
    // Bogus comment state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBogusComment = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentComment(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.data += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            default: {
                token.data += String.fromCodePoint(cp);
            }
        }
    };
    // Markup declaration open state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateMarkupDeclarationOpen = function (cp) {
        if (this._consumeSequenceIfMatch(unicode_js_1.SEQUENCES.DASH_DASH, true)) {
            this._createCommentToken(unicode_js_1.SEQUENCES.DASH_DASH.length + 1);
            this.state = 42 /* State.COMMENT_START */;
        }
        else if (this._consumeSequenceIfMatch(unicode_js_1.SEQUENCES.DOCTYPE, false)) {
            // NOTE: Doctypes tokens are created without fixed offsets. We keep track of the moment a doctype *might* start here.
            this.currentLocation = this.getCurrentLocation(unicode_js_1.SEQUENCES.DOCTYPE.length + 1);
            this.state = 52 /* State.DOCTYPE */;
        }
        else if (this._consumeSequenceIfMatch(unicode_js_1.SEQUENCES.CDATA_START, true)) {
            if (this.inForeignNode) {
                this.state = 68 /* State.CDATA_SECTION */;
            }
            else {
                this._err(error_codes_js_1.ERR.cdataInHtmlContent);
                this._createCommentToken(unicode_js_1.SEQUENCES.CDATA_START.length + 1);
                this.currentToken.data = '[CDATA[';
                this.state = 40 /* State.BOGUS_COMMENT */;
            }
        }
        //NOTE: Sequence lookups can be abrupted by hibernation. In that case, lookup
        //results are no longer valid and we will need to start over.
        else if (!this._ensureHibernation()) {
            this._err(error_codes_js_1.ERR.incorrectlyOpenedComment);
            this._createCommentToken(2);
            this.state = 40 /* State.BOGUS_COMMENT */;
            this._stateBogusComment(cp);
        }
    };
    // Comment start state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentStart = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 43 /* State.COMMENT_START_DASH */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptClosingOfEmptyComment);
                this.state = 0 /* State.DATA */;
                var token = this.currentToken;
                this.emitCurrentComment(token);
                break;
            }
            default: {
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // Comment start dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentStartDash = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 50 /* State.COMMENT_END */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptClosingOfEmptyComment);
                this.state = 0 /* State.DATA */;
                this.emitCurrentComment(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInComment);
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.data += '-';
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // Comment state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateComment = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 49 /* State.COMMENT_END_DASH */;
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                token.data += '<';
                this.state = 45 /* State.COMMENT_LESS_THAN_SIGN */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.data += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInComment);
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.data += String.fromCodePoint(cp);
            }
        }
    };
    // Comment less-than sign state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentLessThanSign = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.EXCLAMATION_MARK: {
                token.data += '!';
                this.state = 46 /* State.COMMENT_LESS_THAN_SIGN_BANG */;
                break;
            }
            case unicode_js_1.CODE_POINTS.LESS_THAN_SIGN: {
                token.data += '<';
                break;
            }
            default: {
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // Comment less-than sign bang state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentLessThanSignBang = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.HYPHEN_MINUS) {
            this.state = 47 /* State.COMMENT_LESS_THAN_SIGN_BANG_DASH */;
        }
        else {
            this.state = 44 /* State.COMMENT */;
            this._stateComment(cp);
        }
    };
    // Comment less-than sign bang dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentLessThanSignBangDash = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.HYPHEN_MINUS) {
            this.state = 48 /* State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH */;
        }
        else {
            this.state = 49 /* State.COMMENT_END_DASH */;
            this._stateCommentEndDash(cp);
        }
    };
    // Comment less-than sign bang dash dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentLessThanSignBangDashDash = function (cp) {
        if (cp !== unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN && cp !== unicode_js_1.CODE_POINTS.EOF) {
            this._err(error_codes_js_1.ERR.nestedComment);
        }
        this.state = 50 /* State.COMMENT_END */;
        this._stateCommentEnd(cp);
    };
    // Comment end dash state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentEndDash = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                this.state = 50 /* State.COMMENT_END */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInComment);
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.data += '-';
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // Comment end state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentEnd = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentComment(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EXCLAMATION_MARK: {
                this.state = 51 /* State.COMMENT_END_BANG */;
                break;
            }
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                token.data += '-';
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInComment);
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.data += '--';
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // Comment end bang state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCommentEndBang = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.HYPHEN_MINUS: {
                token.data += '--!';
                this.state = 49 /* State.COMMENT_END_DASH */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.incorrectlyClosedComment);
                this.state = 0 /* State.DATA */;
                this.emitCurrentComment(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInComment);
                this.emitCurrentComment(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.data += '--!';
                this.state = 44 /* State.COMMENT */;
                this._stateComment(cp);
            }
        }
    };
    // DOCTYPE state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctype = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 53 /* State.BEFORE_DOCTYPE_NAME */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 53 /* State.BEFORE_DOCTYPE_NAME */;
                this._stateBeforeDoctypeName(cp);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                this._createDoctypeToken(null);
                var token = this.currentToken;
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingWhitespaceBeforeDoctypeName);
                this.state = 53 /* State.BEFORE_DOCTYPE_NAME */;
                this._stateBeforeDoctypeName(cp);
            }
        }
    };
    // Before DOCTYPE name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBeforeDoctypeName = function (cp) {
        if (isAsciiUpper(cp)) {
            this._createDoctypeToken(String.fromCharCode(toAsciiLower(cp)));
            this.state = 54 /* State.DOCTYPE_NAME */;
        }
        else
            switch (cp) {
                case unicode_js_1.CODE_POINTS.SPACE:
                case unicode_js_1.CODE_POINTS.LINE_FEED:
                case unicode_js_1.CODE_POINTS.TABULATION:
                case unicode_js_1.CODE_POINTS.FORM_FEED: {
                    // Ignore whitespace
                    break;
                }
                case unicode_js_1.CODE_POINTS.NULL: {
                    this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                    this._createDoctypeToken(unicode_js_1.REPLACEMENT_CHARACTER);
                    this.state = 54 /* State.DOCTYPE_NAME */;
                    break;
                }
                case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                    this._err(error_codes_js_1.ERR.missingDoctypeName);
                    this._createDoctypeToken(null);
                    var token = this.currentToken;
                    token.forceQuirks = true;
                    this.emitCurrentDoctype(token);
                    this.state = 0 /* State.DATA */;
                    break;
                }
                case unicode_js_1.CODE_POINTS.EOF: {
                    this._err(error_codes_js_1.ERR.eofInDoctype);
                    this._createDoctypeToken(null);
                    var token = this.currentToken;
                    token.forceQuirks = true;
                    this.emitCurrentDoctype(token);
                    this._emitEOFToken();
                    break;
                }
                default: {
                    this._createDoctypeToken(String.fromCodePoint(cp));
                    this.state = 54 /* State.DOCTYPE_NAME */;
                }
            }
    };
    // DOCTYPE name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctypeName = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 55 /* State.AFTER_DOCTYPE_NAME */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.name += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
            }
        }
    };
    // After DOCTYPE name state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterDoctypeName = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default:
                if (this._consumeSequenceIfMatch(unicode_js_1.SEQUENCES.PUBLIC, false)) {
                    this.state = 56 /* State.AFTER_DOCTYPE_PUBLIC_KEYWORD */;
                }
                else if (this._consumeSequenceIfMatch(unicode_js_1.SEQUENCES.SYSTEM, false)) {
                    this.state = 62 /* State.AFTER_DOCTYPE_SYSTEM_KEYWORD */;
                }
                //NOTE: sequence lookup can be abrupted by hibernation. In that case lookup
                //results are no longer valid and we will need to start over.
                else if (!this._ensureHibernation()) {
                    this._err(error_codes_js_1.ERR.invalidCharacterSequenceAfterDoctypeName);
                    token.forceQuirks = true;
                    this.state = 67 /* State.BOGUS_DOCTYPE */;
                    this._stateBogusDoctype(cp);
                }
        }
    };
    // After DOCTYPE public keyword state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterDoctypePublicKeyword = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 57 /* State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this._err(error_codes_js_1.ERR.missingWhitespaceAfterDoctypePublicKeyword);
                token.publicId = '';
                this.state = 58 /* State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this._err(error_codes_js_1.ERR.missingWhitespaceAfterDoctypePublicKeyword);
                token.publicId = '';
                this.state = 59 /* State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.missingDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // Before DOCTYPE public identifier state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBeforeDoctypePublicIdentifier = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                token.publicId = '';
                this.state = 58 /* State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                token.publicId = '';
                this.state = 59 /* State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.missingDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // DOCTYPE public identifier (double-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctypePublicIdentifierDoubleQuoted = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this.state = 60 /* State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.publicId += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.publicId += String.fromCodePoint(cp);
            }
        }
    };
    // DOCTYPE public identifier (single-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctypePublicIdentifierSingleQuoted = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this.state = 60 /* State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.publicId += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptDoctypePublicIdentifier);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.publicId += String.fromCodePoint(cp);
            }
        }
    };
    // After DOCTYPE public identifier state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterDoctypePublicIdentifier = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 61 /* State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this._err(error_codes_js_1.ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
                token.systemId = '';
                this.state = 64 /* State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this._err(error_codes_js_1.ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
                token.systemId = '';
                this.state = 65 /* State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // Between DOCTYPE public and system identifiers state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBetweenDoctypePublicAndSystemIdentifiers = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                token.systemId = '';
                this.state = 64 /* State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                token.systemId = '';
                this.state = 65 /* State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // After DOCTYPE system keyword state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterDoctypeSystemKeyword = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                this.state = 63 /* State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this._err(error_codes_js_1.ERR.missingWhitespaceAfterDoctypeSystemKeyword);
                token.systemId = '';
                this.state = 64 /* State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this._err(error_codes_js_1.ERR.missingWhitespaceAfterDoctypeSystemKeyword);
                token.systemId = '';
                this.state = 65 /* State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.missingDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // Before DOCTYPE system identifier state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBeforeDoctypeSystemIdentifier = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                token.systemId = '';
                this.state = 64 /* State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                token.systemId = '';
                this.state = 65 /* State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.missingDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 0 /* State.DATA */;
                this.emitCurrentDoctype(token);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.missingQuoteBeforeDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // DOCTYPE system identifier (double-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctypeSystemIdentifierDoubleQuoted = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.QUOTATION_MARK: {
                this.state = 66 /* State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.systemId += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.systemId += String.fromCodePoint(cp);
            }
        }
    };
    // DOCTYPE system identifier (single-quoted) state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDoctypeSystemIdentifierSingleQuoted = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.APOSTROPHE: {
                this.state = 66 /* State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                token.systemId += unicode_js_1.REPLACEMENT_CHARACTER;
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this._err(error_codes_js_1.ERR.abruptDoctypeSystemIdentifier);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                token.systemId += String.fromCodePoint(cp);
            }
        }
    };
    // After DOCTYPE system identifier state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAfterDoctypeSystemIdentifier = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.SPACE:
            case unicode_js_1.CODE_POINTS.LINE_FEED:
            case unicode_js_1.CODE_POINTS.TABULATION:
            case unicode_js_1.CODE_POINTS.FORM_FEED: {
                // Ignore whitespace
                break;
            }
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInDoctype);
                token.forceQuirks = true;
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default: {
                this._err(error_codes_js_1.ERR.unexpectedCharacterAfterDoctypeSystemIdentifier);
                this.state = 67 /* State.BOGUS_DOCTYPE */;
                this._stateBogusDoctype(cp);
            }
        }
    };
    // Bogus DOCTYPE state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateBogusDoctype = function (cp) {
        var token = this.currentToken;
        switch (cp) {
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.emitCurrentDoctype(token);
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.NULL: {
                this._err(error_codes_js_1.ERR.unexpectedNullCharacter);
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this.emitCurrentDoctype(token);
                this._emitEOFToken();
                break;
            }
            default:
            // Do nothing
        }
    };
    // CDATA section state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCdataSection = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.RIGHT_SQUARE_BRACKET: {
                this.state = 69 /* State.CDATA_SECTION_BRACKET */;
                break;
            }
            case unicode_js_1.CODE_POINTS.EOF: {
                this._err(error_codes_js_1.ERR.eofInCdata);
                this._emitEOFToken();
                break;
            }
            default: {
                this._emitCodePoint(cp);
            }
        }
    };
    // CDATA section bracket state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCdataSectionBracket = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.RIGHT_SQUARE_BRACKET) {
            this.state = 70 /* State.CDATA_SECTION_END */;
        }
        else {
            this._emitChars(']');
            this.state = 68 /* State.CDATA_SECTION */;
            this._stateCdataSection(cp);
        }
    };
    // CDATA section end state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCdataSectionEnd = function (cp) {
        switch (cp) {
            case unicode_js_1.CODE_POINTS.GREATER_THAN_SIGN: {
                this.state = 0 /* State.DATA */;
                break;
            }
            case unicode_js_1.CODE_POINTS.RIGHT_SQUARE_BRACKET: {
                this._emitChars(']');
                break;
            }
            default: {
                this._emitChars(']]');
                this.state = 68 /* State.CDATA_SECTION */;
                this._stateCdataSection(cp);
            }
        }
    };
    // Character reference state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateCharacterReference = function (cp) {
        if (cp === unicode_js_1.CODE_POINTS.NUMBER_SIGN) {
            this.state = 74 /* State.NUMERIC_CHARACTER_REFERENCE */;
        }
        else if (isAsciiAlphaNumeric(cp)) {
            this.state = 72 /* State.NAMED_CHARACTER_REFERENCE */;
            this._stateNamedCharacterReference(cp);
        }
        else {
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.AMPERSAND);
            this._reconsumeInState(this.returnState, cp);
        }
    };
    // Named character reference state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateNamedCharacterReference = function (cp) {
        var matchResult = this._matchNamedCharacterReference(cp);
        //NOTE: Matching can be abrupted by hibernation. In that case, match
        //results are no longer valid and we will need to start over.
        if (this._ensureHibernation()) {
            // Stay in the state, try again.
        }
        else if (matchResult) {
            for (var i = 0; i < matchResult.length; i++) {
                this._flushCodePointConsumedAsCharacterReference(matchResult[i]);
            }
            this.state = this.returnState;
        }
        else {
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.AMPERSAND);
            this.state = 73 /* State.AMBIGUOUS_AMPERSAND */;
        }
    };
    // Ambiguos ampersand state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateAmbiguousAmpersand = function (cp) {
        if (isAsciiAlphaNumeric(cp)) {
            this._flushCodePointConsumedAsCharacterReference(cp);
        }
        else {
            if (cp === unicode_js_1.CODE_POINTS.SEMICOLON) {
                this._err(error_codes_js_1.ERR.unknownNamedCharacterReference);
            }
            this._reconsumeInState(this.returnState, cp);
        }
    };
    // Numeric character reference state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateNumericCharacterReference = function (cp) {
        this.charRefCode = 0;
        if (cp === unicode_js_1.CODE_POINTS.LATIN_SMALL_X || cp === unicode_js_1.CODE_POINTS.LATIN_CAPITAL_X) {
            this.state = 75 /* State.HEXADEMICAL_CHARACTER_REFERENCE_START */;
        }
        // Inlined decimal character reference start state
        else if (isAsciiDigit(cp)) {
            this.state = 77 /* State.DECIMAL_CHARACTER_REFERENCE */;
            this._stateDecimalCharacterReference(cp);
        }
        else {
            this._err(error_codes_js_1.ERR.absenceOfDigitsInNumericCharacterReference);
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.AMPERSAND);
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.NUMBER_SIGN);
            this._reconsumeInState(this.returnState, cp);
        }
    };
    // Hexademical character reference start state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateHexademicalCharacterReferenceStart = function (cp) {
        if (isAsciiHexDigit(cp)) {
            this.state = 76 /* State.HEXADEMICAL_CHARACTER_REFERENCE */;
            this._stateHexademicalCharacterReference(cp);
        }
        else {
            this._err(error_codes_js_1.ERR.absenceOfDigitsInNumericCharacterReference);
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.AMPERSAND);
            this._flushCodePointConsumedAsCharacterReference(unicode_js_1.CODE_POINTS.NUMBER_SIGN);
            this._unconsume(2);
            this.state = this.returnState;
        }
    };
    // Hexademical character reference state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateHexademicalCharacterReference = function (cp) {
        if (isAsciiUpperHexDigit(cp)) {
            this.charRefCode = this.charRefCode * 16 + cp - 0x37;
        }
        else if (isAsciiLowerHexDigit(cp)) {
            this.charRefCode = this.charRefCode * 16 + cp - 0x57;
        }
        else if (isAsciiDigit(cp)) {
            this.charRefCode = this.charRefCode * 16 + cp - 0x30;
        }
        else if (cp === unicode_js_1.CODE_POINTS.SEMICOLON) {
            this.state = 78 /* State.NUMERIC_CHARACTER_REFERENCE_END */;
        }
        else {
            this._err(error_codes_js_1.ERR.missingSemicolonAfterCharacterReference);
            this.state = 78 /* State.NUMERIC_CHARACTER_REFERENCE_END */;
            this._stateNumericCharacterReferenceEnd(cp);
        }
    };
    // Decimal character reference state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateDecimalCharacterReference = function (cp) {
        if (isAsciiDigit(cp)) {
            this.charRefCode = this.charRefCode * 10 + cp - 0x30;
        }
        else if (cp === unicode_js_1.CODE_POINTS.SEMICOLON) {
            this.state = 78 /* State.NUMERIC_CHARACTER_REFERENCE_END */;
        }
        else {
            this._err(error_codes_js_1.ERR.missingSemicolonAfterCharacterReference);
            this.state = 78 /* State.NUMERIC_CHARACTER_REFERENCE_END */;
            this._stateNumericCharacterReferenceEnd(cp);
        }
    };
    // Numeric character reference end state
    //------------------------------------------------------------------
    Tokenizer.prototype._stateNumericCharacterReferenceEnd = function (cp) {
        if (this.charRefCode === unicode_js_1.CODE_POINTS.NULL) {
            this._err(error_codes_js_1.ERR.nullCharacterReference);
            this.charRefCode = unicode_js_1.CODE_POINTS.REPLACEMENT_CHARACTER;
        }
        else if (this.charRefCode > 1114111) {
            this._err(error_codes_js_1.ERR.characterReferenceOutsideUnicodeRange);
            this.charRefCode = unicode_js_1.CODE_POINTS.REPLACEMENT_CHARACTER;
        }
        else if ((0, unicode_js_1.isSurrogate)(this.charRefCode)) {
            this._err(error_codes_js_1.ERR.surrogateCharacterReference);
            this.charRefCode = unicode_js_1.CODE_POINTS.REPLACEMENT_CHARACTER;
        }
        else if ((0, unicode_js_1.isUndefinedCodePoint)(this.charRefCode)) {
            this._err(error_codes_js_1.ERR.noncharacterCharacterReference);
        }
        else if ((0, unicode_js_1.isControlCodePoint)(this.charRefCode) || this.charRefCode === unicode_js_1.CODE_POINTS.CARRIAGE_RETURN) {
            this._err(error_codes_js_1.ERR.controlCharacterReference);
            var replacement = C1_CONTROLS_REFERENCE_REPLACEMENTS.get(this.charRefCode);
            if (replacement !== undefined) {
                this.charRefCode = replacement;
            }
        }
        this._flushCodePointConsumedAsCharacterReference(this.charRefCode);
        this._reconsumeInState(this.returnState, cp);
    };
    return Tokenizer;
}());
exports.Tokenizer = Tokenizer;
