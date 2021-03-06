/**
 * @fileOverview Borschik tech to freeze files in HTML.
 */

var cssBase = require('./css-base');
var U = require('../util');

const uniqStr = '\00borschik\00';

const additionalFreezeExtsRe = /\.(?:css|js|swf)$/;

/**
 * RegExp to find href="1.css" | src="1.js"
 * @const
 * @type {RegExp}
 */
const allIncRe = /<!-->|<!--[^\[<][\s\S]*?-->|href="(.+?)"|src="(.+?)"|background="(.+?)"/g;

exports.Tech = cssBase.Tech.inherit({
    minimize: function(content) {
        // no minimize for this tech
        return content;
    },

    File: exports.File = cssBase.File.inherit({
        parseInclude: function(content) {
            var includes = [];
            var _this = this;

            var text = content instanceof Buffer ? content.toString('utf-8') : content;

            var texts = text
                .replace(allIncRe, function(_, includeHref, includeSrc, includeBackground) {
                    if (includeHref && U.isLinkProcessable(includeHref) && _this.isFreezableUrl(includeHref)) {
                        includes.push({
                            url: _this.pathTo(includeHref),
                            type: 'href'
                        });

                    } else if (includeSrc && U.isLinkProcessable(includeSrc) && _this.isFreezableUrl(includeSrc)) {
                        includes.push({
                            url: _this.pathTo(includeSrc),
                            type: 'src'
                        });

                    } else if (includeBackground && U.isLinkProcessable(includeBackground) && _this.isFreezableUrl(includeBackground)) {
                        includes.push({
                            url: _this.pathTo(includeBackground),
                            type: 'background'
                        });

                    } else {
                        includes.push({
                            file: _,
                            type: 'comment'
                        });
                    }

                    return uniqStr;

                })
                .split(uniqStr);

            // zip texts and includes
            var res = [], t, i;
            while((t = texts.shift()) != null) {
                t && res.push(t);
                (i = includes.shift()) && res.push(i);
            }

            return res;
        },

        processInclude: function(baseFile, content) {
            var parsed = content || this.content;

            for(var i = 0; i < parsed.length; i++) {
                var item = parsed[i];

                if (typeof item == 'string') {
                    continue;
                }

                if (item.type == 'href' || item.type == 'src' || item.type == 'background') {
                    // freeze images with cssBase.processLink
                    parsed[i] = item.type + '=' + this.child(item.type, item.url).process(baseFile);

                } else {
                    parsed[i] = item.file;
                }
            }

            return parsed.join('');
        },

        isFreezableUrl: function(url) {
            return this.__base(url) || additionalFreezeExtsRe.test(url);
        }
    })
});
