'use strict'; // eslint-disable-line strict
const Fuse = require('fuse.js');

// Set option for fuzzy search
const fuzzySearchOptions = {
    caseSensitive: false, // Don't care about case whenever we're searching titles by speech
    includeScore: false, // Don't need the score, the first item has the highest probability
    shouldSort: true, // Should be true, since we want result[0] to be the item with the highest probability
    threshold: 0.4, // 0 = perfect match, 1 = match all..
    location: 0,
    distance: 100,
    maxPatternLength: 64,
    keys: ['label']
};

exports.kodiPlayPause = (request, response, conf) => { // eslint-disable-line no-unused-vars
    console.log('Play/Pause request received');
    kodi.Player.PlayPause({ // eslint-disable-line new-cap
        playerid: 1
    });
    response.sendStatus(200);
};

exports.kodiStop = (request, response, conf) => { // eslint-disable-line no-unused-vars
    console.log('Stop request received');
    kodi.Player.Stop({ // eslint-disable-line new-cap
        playerid: 1
    });
    response.sendStatus(200);
};

exports.kodiMuteToggle = (request, response, conf) => { // eslint-disable-line no-unused-vars
    console.log('mute/unmute request received');
    kodi.Application.SetMute({ // eslint-disable-line new-cap
        'mute': 'toggle'
    });
    response.sendStatus(200);
};

exports.kodiSetVolume = (request, response, conf) => { // eslint-disable-line no-unused-vars
    let setVolume = request.query.q.trim();

    console.log(`set volume to "${setVolume}" percent request received`);
    kodi.Application.SetVolume({ // eslint-disable-line new-cap
        'volume': parseInt(setVolume)
    });
    response.sendStatus(200);
};

exports.kodiActivateTv = (request, response, conf) => { // eslint-disable-line no-unused-vars
    console.log('Activate TV request received');

    let params = {
        addonid: 'script.json-cec',
        params: {
            command: 'activate'
        }
    };

    kodi.Addons.ExecuteAddon(params); // eslint-disable-line new-cap
};

const tryActivateTv = () => {
    if (process.env.ACTIVATE_TV != null && process.env.ACTIVATE_TV === 'true') {
        console.log('Activating TV first..');
        kodiActivateTv(null, null);
    }
};

const kodiFindMovie = (movieTitle, conf) => {
    return new Promise((resolve, reject) => {
        let firstKodi = conf.kodiHosts[0].host;

        firstKodi.VideoLibrary.GetMovies() // eslint-disable-line new-cap
        .then((movies) => {
            if (!(movies && movies.result && movies.result.movies && movies.result.movies.length > 0)) {
                throw new Error('no results');
            }

            // Create the fuzzy search object
            let fuse = new Fuse(movies.result.movies, fuzzySearchOptions);
            let searchResult = fuse.search(movieTitle);

            // If there's a result
            if (searchResult.length > 0) {
                let movieFound = searchResult[0];

                console.log(`Found movie "${movieFound.label}" (${movieFound.movieid})`);
                resolve(movieFound);
            } else {
                reject(`Couldn't find movie "${movieTitle}"`);
            }
        })
        .catch((e) => {
            reject(e);
        });
    });
};

exports.kodiPlayMovie = (request, response, conf) => { // eslint-disable-line no-unused-vars
    tryActivateTv();

    let movieTitle = request.query.q.trim();

    console.log(`Movie request received to play "${movieTitle}"`);
    kodiFindMovie(movieTitle, conf).then((data) => {
        let firstKodi = conf.kodiHosts[0].host;

        return firstKodi.Player.Open({ // eslint-disable-line new-cap
            item: {
                movieid: data.movieid
            }
        });
    });
    response.sendStatus(200);
};

const kodiFindTvShow = (request, res, param) => {
    return new Promise((resolve, reject) => {
        kodi.VideoLibrary.GetTVShows({ // eslint-disable-line new-cap
            'properties': ['file']
        }).then((shows) => {
            if (!(shows && shows.result && shows.result.tvshows && shows.result.tvshows.length > 0)) {
                throw new Error('no results');
            }
            // Create the fuzzy search object
            let fuse = new Fuse(shows.result.tvshows, fuzzySearchOptions);
            let searchResult = fuse.search(param.tvshowTitle);

            // If there's a result
            if (searchResult.length > 0 && searchResult[0].tvshowid != null) {
                resolve(searchResult[0]);
            } else {
                reject(`Couldn't find tv show "${param.tvshowTitle}"`);
            }
        }).catch((e) => {
            console.log(e);
        });
    });
};

const kodiPlayNextUnwatchedEpisode = (request, res, RequestParams) => {
    console.log(`Searching for next episode of Show ID ${RequestParams.tvshowid}...`);
    // Build filter to search unwatched episodes
    let param = {
        tvshowid: RequestParams.tvshowid,
        properties: ['playcount', 'showtitle', 'season', 'episode'],
        // Sort the result so we can grab the first unwatched episode
        sort: {
            order: 'ascending',
            method: 'episode',
            ignorearticle: true
        }
    };

    kodi.VideoLibrary.GetEpisodes(param) // eslint-disable-line new-cap
        .then((episodeResult) => {
            if (!(episodeResult && episodeResult.result && episodeResult.result.episodes && episodeResult.result.episodes.length > 0)) {
                throw new Error('no results');
            }
            let episodes = episodeResult.result.episodes;

            // Check if there are episodes for this TV show
            if (episodes) {
                console.log('found episodes..');
                // Check whether we have seen this episode already
                let firstUnplayedEpisode = episodes.filter((item) => {
                    // FIXME: This is returned from an async method. So what's the use for this?
                    return item.playcount === 0;
                });

                if (firstUnplayedEpisode.length > 0) {
                    let episdoeToPlay = firstUnplayedEpisode[0]; // Resolve the first unplayed episode

                    console.log(`Playing season ${episdoeToPlay.season} ${episode} ${episdoeToPlay.episode} (ID: ${episdoeToPlay.episodeid})`);
                    let paramPlayerOpen = {
                        item: {
                            episodeid: episdoeToPlay.episodeid
                        }
                    };

                    // FIXME: This is returned from an async method. So what's the use for this?
                    return kodi.Player.Open(paramPlayerOpen); // eslint-disable-line new-cap
                }
            }
        })
        .catch((e) => {
            console.log(e);
        });
    res.sendStatus(200);
};

exports.kodiPlayTvshow = (request, response, conf) => { // eslint-disable-line no-unused-vars
    tryActivateTv();
    let param = {
        tvshowTitle: request.query.q.trim().toLowerCase()
    };

    console.log(`TV Show request received to play "${param.tvshowTitle}"`);

    kodiFindTvShow(request, response, param).then((data) => {
        kodiPlayNextUnwatchedEpisode(request, response, data);
    });
};

const kodiPlaySpecificEpisode = (request, res, RequestParams) => {
    console.log(`Searching Season ${RequestParams.seasonNum}, ${episode} ${RequestParams.episodeNum} of Show ID ${RequestParams.tvshowid}...`);

    // Build filter to search for specific season number
    let param = {
        tvshowid: RequestParams.tvshowid,
        // episode: requestedEpisodeNum,
        season: parseInt(RequestParams.seasonNum),
        properties: ['playcount', 'showtitle', 'season', 'episode']
    };

    kodi.VideoLibrary.GetEpisodes(param) // eslint-disable-line new-cap
        .then((episodeResult) => {
            if (!(episodeResult && episodeResult.result && episodeResult.result.episodes && episodeResult.result.episodes.length > 0)) {
                throw new Error('no results');
            }
            let episodes = episodeResult.result.episodes;

            // Check if there are episodes for this TV show
            if (episodes) {
                console.log('found episodes..');
                // Check for the episode number requested
                let matchedEpisodes = episodes.filter((item) => {
                    // FIXME: This is returned from an async method. So what's the use for this?
                    return item.episode === parseInt(RequestParams.episodeNum);
                });

                if (matchedEpisodes.length > 0) {
                    let episdoeToPlay = matchedEpisodes[0];

                    console.log(`Playing season ${episdoeToPlay.season} ${episode} ${episdoeToPlay.episode} (ID: ${episdoeToPlay.episodeid})`);
                    let paramPlayerOpen = {
                        item: {
                            episodeid: episdoeToPlay.episodeid
                        }
                    };
                    
                    kodi.Player.Open(paramPlayerOpen); // eslint-disable-line new-cap
                }
            }
        })
        .catch((e) => {
            console.log(e);
        });
    res.sendStatus(200);
};

exports.kodiPlayEpisodeHandler = (request, response, conf) => { // eslint-disable-line no-unused-vars
    tryActivateTv();
    let requestPartOne = request.query.q.split('season');
    let param = {
        tvshowTitle: requestPartOne[0].trim().toLowerCase(),
        seasonNum: requestPartOne[1].trim().toLowerCase(),
        episodeNum: request.query.e
    };

    console.log(`Specific Episode request received to play ${param.tvshowTitle} ${Season} ${param.seasonNum} ${Episode} ${param.episodeNum}`);

    kodiFindTvShow(request, response, param).then((data) => {
        kodiPlaySpecificEpisode(request, response, data);
    });
};

const kodiOpenVideoWindow = (file) => {
    let params = {
        'window': 'videos',
        'parameters': [file]
    };

    kodi.GUI.ActivateWindow(params); // eslint-disable-line new-cap
};

exports.kodiOpenTvshow = (request, response, conf) => {
    let param = {
        tvshowTitle: request.query.q.trim().toLowerCase()
    };

    kodiFindTvShow(request, response, param).then((data) => {
        kodiOpenVideoWindow(data.file);
    });
};

// Start a full library scan
exports.kodiScanLibrary = (request, response, conf) => {
    kodi.VideoLibrary.Scan(); // eslint-disable-line new-cap
    response.sendStatus(200);
};

const tryPlayingChannelInGroup = (searchOptions, reqChannel, chGroups, currGroupI) => {
    if (currGroupI < chGroups.length) {

        // Build filter to search for all channel under the channel group
        let param = {
            channelgroupid: chGroups[currGroupI].channelgroupid
        };

        kodi.PVR.GetChannels(param).then((channels) => { // eslint-disable-line new-cap
            if (!(channels && channels.result && channels.result.channels && channels.result.channels.length > 0)) {
                throw new Error('no channels were found');
            }

            let rChannels = channels.result.channels;
            // Create the fuzzy search object
            let fuse = new Fuse(rChannels, searchOptions);
            let searchResult = fuse.search(reqChannel);

            // If there's a result
            if (searchResult.length > 0) {
                let channelFound = searchResult[0];

                console.log(`Found PVR channel ${channelFound.label} - ${channelFound.channelnumber} (${channelFound.channelid})`);
                kodi.Player.Open({ // eslint-disable-line new-cap
                    item: {
                        channelid: channelFound.channelid
                    }
                });
            } else {
                tryPlayingChannelInGroup(searchOptions, reqChannel, chGroups, currGroupI + 1);
            }
        }).catch((e) => {
            console.log(e);
        });
    }
};

const kodiPlayChannel = (request, response, searchOptions) => {

    let reqChannel = request.query.q.trim();

    console.log(`PVR channel request received to play "${reqChannel}"`);

    // Build filter to search TV channel groups
    let param = {
        channeltype: 'tv'
    };

    kodi.PVR.GetChannelGroups(param) // eslint-disable-line new-cap
        .then((channelGroups) => {
            if (!(channelGroups && channelGroups.result && channelGroups.result.channelgroups && channelGroups.result.channelgroups.length > 0)) {
                throw new Error('no channels group were found. Perhaps PVR is not setup?');
            }

            // For each tv PVR channel group, search for all channels
            let chGroups = channelGroups.result.channelgroups;

            tryPlayingChannelInGroup(searchOptions, reqChannel, chGroups, 0);
        })
        .catch((e) => {
            console.log(e);
        });
};

exports.kodiPlayChannelByName = (request, response, conf) => { // eslint-disable-line no-unused-vars
    tryActivateTv();
    kodiPlayChannel(request, response, fuzzySearchOptions);
};

exports.kodiPlayChannelByNumber = (request, response, conf) => { // eslint-disable-line no-unused-vars
    tryActivateTv();
    let pvrFuzzySearchOptions = JSON.parse(JSON.stringify(fuzzySearchOptions));

    pvrFuzzySearchOptions.keys[0] = 'channelnumber';
    kodiPlayChannel(request, response, pvrFuzzySearchOptions);
};