var fs = require('fs');
var path = require('path');
var vow = require('vow');

var base = require('./css-base');
var error = require('../error');
var utils = require('../util');

var nodes = require('./js/nodes');
var NodesSerializer = require('./js/nodes-serializer');

exports.Tech = base.Tech.inherit({
    process: function() {
        var opts = this.opts;
        var out = opts.output;
        var techOpts = opts.techOptions;

        try {
            var processed = this.handleIncludes();
            var content = processed.getContent();
            var sourceMap = processed.getSourceMap();

            if (opts.minimize) {
                // By default, borschik maintains actual state of the source map on the minification step.
                // But there are rare cases when such behaviour may be inappropriate, e.g., when the original
                // source map (after processing) is used to restore coverage info (see `istanbul-lib-source-maps`).
                var minifySourceMap = sourceMap && techOpts.minifySourceMap !== false;
                // Pass original source map to `uglify-es`.
                var uglifyOptions = techOpts.uglify || (techOpts.uglify = {});
                uglifyOptions.sourceMap = minifySourceMap ? { content: sourceMap } : undefined;

                var minimized = this.handleMinimization(content);
                content = minimized.code;
                if (minifySourceMap) {
                    sourceMap = minimized.map;
                }
            }

            if (sourceMap) {
                // Add source mapping URL comment (with dataurl or .map file).
                content += this.buildSourceMapURLComment(sourceMap);
            }
        } catch(e) {
            return vow.reject(e);
        }

        if (opts.inputString && !out.path) {
            // `content`-only resolve is for backward compatibility.
            return vow.resolve(sourceMap ? [content, sourceMap] : content);
        }

        return vow.all([
            this.write(out, content),
            sourceMap ? this.write(this.sourceMapPath(), sourceMap) : vow.resolve()
        ]);
    },

    minimize: function(content) {
        var UglifyJS = require('uglify-es');
        try {
            var uglifyOptions = this.opts.techOptions.uglify || {};

            var res = UglifyJS.minify(content, uglifyOptions);

            if (res.error) throw res.error;

            return res;

        } catch(e) {
            // create better error message
            var lines = content.split('\n');
            throw error.explain(lines, e);
        }
    },

    buildSourceMapURLComment: function(sourceMap) {
        var techOpts = this.opts.techOptions;
        if (techOpts.sourceMapURL === false) {
            return '';
        }

        return techOpts.sourceMap === 'inline'
            ? utils.buildSourceMapURLComment({ inline: sourceMap })
            : utils.buildSourceMapURLComment({ url: techOpts.sourceMapURL || path.basename(this.sourceMapPath()) });
    },

    sourceMapPath: function() {
        return (this.opts.output.path || this.opts.baseFilename || '') + '.map';
    },

    File: exports.File = base.File.inherit({
        /**
         * @param {Buffer|String} content
         */
        parseInclude: function(content) {
            if (Buffer.isBuffer(content)) {
                content = content.toString('utf8');
            }

            var allIncRe = new RegExp([
                    ['\\{/\\*!?', '\\*/\\}'],
                    ['\\[/\\*!?', '\\*/\\]'],
                    ['/\\*!?', '\\*/'],
                    ['[\'"]', '[\'"]']
                ]
                .map(function(i) {
                    return ['(?:', i[0], '\\s*borschik:include:(.*?)\\s*', i[1], ')'].join('');
                })
                .join('|')
                + '|' +
                // RegExp to find borschik.link("path/to/image.png")
                'borschik\\.link\\([\'"]([^@][^"\']+?)[\'"]\\)'
                + '|' +
                // RegExp to find borschik.include("path/to/file.js")
                'borschik\\.include\\([\'"]([^@][^"\']+?)[\'"]\\)',
                'g');

            var uniqStr = '\00borschik\00';
            var _this = this;

            var includes = [];
            var texts = content
                // Finds /*borschik:include:*/, "borschik:include:", borschik.include(), borschik.link().
                .replace(allIncRe, function(_, incObjectFile, incArrayFile, incCommFile, incStrFile, borschikLink, borschikInc) {
                    var incFile = incObjectFile || incArrayFile || incCommFile || incStrFile || borschikInc;
                    if (incFile) {

                        if( incFile.split('/').find( x => x !== undefined) === 'node_modules' ) {
                            incFile = path.join(process.cwd(), incFile);
                        }

                        includes.push({
                            file: _this.pathTo(incFile),
                            type: incStrFile? 'include-json' : 'include-inline',
                            directive: _
                        });
                    } else {
                        includes.push({
                            file: _this.pathTo(borschikLink),
                            type: 'link-url',
                            directive: _
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
            var self = this;
            var opts = this.tech.opts;

            var parsed = (content || this.content).map(function(item) {
                if (typeof item === 'string') {
                    return new nodes.StringNode(item, self.path);
                }

                if (item.type === 'link-url') {
                    return new nodes.LinkURLNode(self.child(item.type, item.file).process(baseFile), self.path, item.directive);
                }

                if (!fs.existsSync(item.file)) {
                    throw new Error('File ' + item.file + ' does not exists, base file is ' + baseFile);
                }

                var processed = self.child('include', item.file).process(baseFile);

                if (item.type === 'include-inline') {
                    var node = new nodes.IncludeNode(processed, self.path, item.directive);
                    if (opts.comments) {
                        node.addCommentsWrap(path.relative(path.dirname(baseFile), item.file));
                    }

                    return node;
                }

                return new nodes.IncludeJSONNode(processed, self.path, item.directive);
            });

            if (this.parent) {
                return parsed;
            }

            var techOpts = opts.techOptions;
            var outPath = opts.output.path || '';
            var serializer = new NodesSerializer(parsed, {
                inputSourceMap: techOpts.inputSourceMap,
                sourceMap: techOpts.sourceMap,
                sourceMapSourceRoot: techOpts.sourceMapSourceRoot,
                sourceMapRoot: techOpts.sourceMapRoot || path.dirname(outPath),
                sourceMapFilename: techOpts.sourceMapFilename || path.basename(outPath)
            });

            return serializer.serialize();
        }
    })
});
