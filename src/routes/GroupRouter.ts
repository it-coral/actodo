//Express Import
import {Router, Request, Response, NextFunction} from 'express';
import {IRequest} from '../classes/IRequest';

//Validation Import
const validate = require('../classes/ParamValidator');
import GroupValidation from '../validations/GroupValidation';
import Action from '../db/models/action';
//Helpers Import
const tokenHelper = require('../tools/tokens');
const toolHelpers = require('../tools/_helpers');
const groupHelper = require('../tools/group_helpers');
//Npm Import
var CSV = require('csv-string');
var moment = require('moment');
var path = require('path'),
    fs = require('fs');
var util = require('util');

//Model Import
import User from '../db/models/user';
import Group from '../db/models/group';

export class GroupRouter {
  router: Router

  /**
   * Initialize the GroupRouter
   */
  constructor() {
    this.router = Router();
    this.init();
  }

  /**
   * @description GET 
   *                - all public and non-deleted groups.
   *                - Exclude group ID 1 from data set (always)
   * 
   *              PLUS any groups the user belongs to only if user is authenticated
   * @param Request
   * @param Response
   * @param Callback (NextFunction)
   */
  public getPublicGroups(req: IRequest, res: Response, next: NextFunction) {
    if(req.query.group_code){ // Look for the group with group_code
      req.publicGroups = req.publicGroups.filter(group=>{
        return group.get('group_code') == req.query.group_code;
      });
    }
    if(req.query.query){ // Look for the group with group_code
      req.publicGroups = req.publicGroups.filter(group=>{
        return group.get('group_code') == req.query.query   //exactly matches to group_code
            || group.get('name').indexOf(req.query.query) > -1; //partially matches to name
      });
    }
    if(req.query.tag){ // Look for the groups with the tags
      let queryTags = CSV.parse(req.query.tag.replace(/ /g,''))[0];// Remove space and select first tag group in the tag list
      
      req.publicGroups = req.publicGroups.filter(function(group){
        let tags = group.related('tags').map(function(a) {
          return a.get('tag');
        });
        return queryTags.filter(tag=>{
          return tags.indexOf(tag) > -1;
        }).length == queryTags.length;
        
      });
    }

    if(req.query.lat && req.query.long && req.query.distance){ // Look for the groups in diameter with lat and long
      req.publicGroups = req.publicGroups.filter(function(group){
        if(toolHelpers.getDistanceFromLatLonInMile(group.get('latitude'), group.get('longitude'), req.query.lat, req.query.long) <= req.query.distance)
         return true;
        return false;
      });
    }
    // //PLUS any groups the user belongs to only if user is authenticated
    // tokenHelper.getUserIdFromRequest(req, (err, user_id, token) => {
    //   if(!err) {
    //     return User.where({user_id: user_id}).fetch({withRelated: [ 
    //       {'groups.tags':function(qb) {
    //         qb.select('group_tag_id', 'tag', 'group_id');
    //       }},
    //       'groups.setting',
    //       {'groups.creator':function(qb) {
    //         qb.column('user_id', 'first_name', 'last_name', 'avatar_file');
    //       }}]
    //     })
    //     .then((user) => {
    //       if(user != null)
    //       {
    //         //Include user groups if authenticated
    //         let merged = req.publicGroups;
    //         let IDs = req.publicGroups.map(function (e) {
    //             return e.id;
    //         });
    //         user.related('groups').models.forEach(group=>{
    //           if( IDs.indexOf(group.id) == -1 )  //remove duplications
    //             merged.push(group);
    //         })
    //         return res.json({  
    //           success: 1,
    //           groups: merged
    //         });
    //       }
    //       return res.json({  
    //         success: 1,
    //         groups: req.publicGroups
    //       });
    //     })
    //     .catch(err => {
    //       res.json({  
    //         success: 0,
    //         message: err.message
    //       });
    //     });
    //   }
    //   else{
    //     // On error cases, just return public/non-deleted/filtered groups
    //     res.json({  
    //       success: 1,
    //       groups: req.publicGroups
    //     });
    //   }
    // })
    res.json({  
      success: 1,
      groups: req.publicGroups
    });
  }

  /**
  * @description Creates a new group
        Call that creates a new group, based on data params:
          Required: name, private, created_by_id (from auth)
          Call should auto-generate a group_code as a 6-digit alpha-numeric code
        Call should automatically create associated group_setting record
          set allow_member_action to 0 (false)
        Call should automatically add a group_user record for the user creating the group
          Set following fields as true: admin_settings, admin_members, mod_actions, mod_comments, submit_action
  * @param Request
  * @param Response
  * @param Callback Function
  */
  public createGroup(req: IRequest, res: Response, next: NextFunction) {
    return new Group({...req.body, created_by_user_id: req.user.id}).save()
      .then((group) => {
        if(req.files){
          try{
            let file = req.files.banner_image_file;
            let relativepath = './public/uploads/groups/banners/'+group.get('group_id')+path.extname(file.name).toLowerCase();
            var targetPath = path.resolve(relativepath);
            if ((path.extname(file.name).toLowerCase() === '.jpg')||
                (path.extname(file.name).toLowerCase() === '.png')) { 

              file.mv(targetPath, function(err) {
                if (err) {
                  err.message = "Upload failed";
                  throw err;
                }
                else {
                  return true;
                }
              });
              let image_url = toolHelpers.getBaseUrl(req) + 'uploads/groups/banners/'+group.get('group_id')+path.extname(file.name).toLowerCase();
              return group.save({banner_image_file:image_url });

            } else {
              let err = new Error();
              err.message = "Only jpg/png are acceptable";
              throw err;
            }
          }catch(err){
            if(!err.message) err.message = "Unknown error prevented from uploading";
            throw err;
          }
        }
        else{
          return group;
          
        }
      })
      .then((group) => {
        req.group = group;
        return group.related('setting').save({allow_member_action: false, member_action_level:0});
      })
      .then((group_setting)=>{
        return req.group.saveCreator();
      })
      .then(()=>{
        return req.group.generateGroupCodeAndSave();
      })
      .then((group) => {
        res.status(201).json({
            success: 1,
            token: tokenHelper.encodeToken(req.user.get('user_id')),
            group: req.group,
            message:"Success"
          });
      })
      .catch((err) => {
        return res.status(500).json({
          success: 0,
          message:err.message,
          data:err.data,  
        });
      });
    }

  /**
   * @description GET group by id in request object
   *          If group is public, return group data
                  group, group_settings, group_user[]
                  creator (user profile info for created_by_user_id)
                  call should be public and not require authorization
              If group is private, only return group data if
                  authorization token is sent with call and user is member of group
                  otherwise return 401 unauthorized
   * @param Request
   * @param Response
   * @param Callback function (NextFunction)
   */
  public getGroup(req: IRequest, res: Response, next: NextFunction) {
    if(req.current_group.get('private') == 1){ //if private
      toolHelpers.isAuthenticated(req)
      .then((user)=>{
        if(user != false){    // If user is authenticated 
          user.getGroupIDs().then(function(groupIDs){  //and member of group
            if(groupIDs.indexOf(req.current_group.get('group_id')) == -1){
              //If user is not a member of group
              return res.status(403).json({
                success: 0,
                message: "You are not member of this group"
              }); 
            }
            else{
              res.status(200).json({
                success: 1,
                group: req.current_group
              });
            }
          });
        }else{
          //Not authenticated
          return res.status(401).json({
            success: 0,
            message: "You are not allowed to access private group"
          }); 
        }
      })
    }
    //Otherwise  -groups is public or user belongs to private group
    else{
      res.status(200).json({
        success: 1,
        group: req.current_group
      });
    }
  }

  /**
  * @description Create GET /groups/:group_id/actions API Call
                  Returns array of all non-deleted actions for the specified group
                  Only return all open actions, and any actions that ended in the last 2 months
                  Exclude any deleted actions (where action.deleted_at is not null)
                  
                  If group is private, only return actions if calling user is a member of the group
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Need to ensure user is member of group, or group is public
  */
  public getGroupActions(req: IRequest, res: Response, next: NextFunction) {
    res.status(200).json({
      success: 1,
      actions: req.current_group.related('open_actions')
    });
  }

  /**
  * @description  createGroupAction
          Create POST /groups/:group_id/actions API Call
              Creates a new action for the specified group
                  -Ensure required fields are sent: title, subtitle, description, thanks_msg, action_type_id
                  -Ensure submitter is a member of the group (group_user record) and:
                    ;Has group_user.submit_action = true
                    ;OR, group_setting.allow_member_action = true 
                       and user has earned points on group actions equal to 
                       or greater than group_setting.member_action_level


          “points” (int): Number of points
              If not specified, set to action_type.default_points
          “start_at” (datetime): Datetime action starts (default now)
          “end_at” (datetime): Datetime action ends (default 1 week)


          Returns the created action
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Need to ensure user is member of group, or group is public
  */
  public createGroupAction(req: IRequest, res: Response, next: NextFunction) {
    if((req.body.start_at && req.body.end_at && req.body.start_at > req.body.end_at) 
    ||(!req.body.start_at && req.body.end_at && moment() > moment(req.body.end_at)))
    {
      res.status(400).json({
        success: 0,
        message: "EndDate cannot be earlier than StartDate"
      })
    }
    req.body.start_at = req.body.start_at ? req.body.start_at : moment().format("YYYY-MM-DD HH:mm:ss");
    req.body.end_at = req.body.end_at ? req.body.end_at : moment(req.body.start_at).add(7, 'days').format("YYYY-MM-DD HH:mm:ss");
    req.body.points = req.body.points ? req.body.points : req.action_type.get('default_points');
    req.body.created_by_user_id = req.user.get('user_id');
    req.body.group_id = req.params.group_id;
    new Action(req.body).save()
    .then(action=>{
      return action.load(['creator', 'action_type']);
    })
    .then(action=>{
      res.status(200).json({
        success: 1,
        action: action
      })
    })
    .catch(err=>{
      res.status(400).json({
        success: 0,
        message: err.message
      })
    })
  }


  /**
  * @description updates details of a group
        Call that updates the group info & settings
        Call should validate that the user has the group_user.admin_settings permission
        If user doesn't have access to admin group, return 401 unauthorized
        Only data params sent to the call are updated
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  */
  public putGroup(req: IRequest, res: Response, next: NextFunction) {
    let settingParam:any = {};
    if(req.body.allow_member_action){   //If allow_member_action param exists
      settingParam.allow_member_action = req.body.allow_member_action; //set to settingParam
      delete req.body.allow_member_action;// ensure it's not sent to update group info
    }
    if(req.body.member_action_level){
      settingParam.member_action_level = req.body.member_action_level;
      delete req.body.member_action_level;
    }

    req.user.isGroupAdminSetting(req.current_group.id)
    .then((hasAdminSetting)=>{
      if(!hasAdminSetting)
        throw new Error("Sorry, You don't have permission to update the group");
      else{
        return req.current_group.save(req.body);
      }
    })
    .then((group) => {
      if(req.files){
        try{
          let file = req.files.banner_image_file;
          let relativepath = './public/uploads/groups/banners/'+group.get('group_id')+path.extname(file.name).toLowerCase();
          var targetPath = path.resolve(relativepath);
          if ((path.extname(file.name).toLowerCase() === '.jpg')||
              (path.extname(file.name).toLowerCase() === '.png')) { 

            file.mv(targetPath, function(err) {
              if (err) {
                err.message = "Upload failed";
                throw err;
              }
              else {
                return true;
              }
            });
            let image_url = toolHelpers.getBaseUrl(req) + 'uploads/groups/banners/'+group.get('group_id')+path.extname(file.name).toLowerCase();
            return group.save({banner_image_file:image_url });

          } else {
            let err = new Error();
            err.message = "Only jpg/png are acceptable";
            throw err;
          }
        }catch(err){
          if(!err.message) err.message = "Unknown error prevented from uploading";
          throw err;
        }
      }
      else{
        return group;
        
      }
    })
    .then((group) => {
      return req.current_group.related('setting').save(settingParam);
    })
    .then(()=>{
      res.status(200).json({
        success: 1,
        token: tokenHelper.encodeToken(req.user.get('user_id')),
        group: req.current_group,
        message:"Success"
      });
    })
    .catch((err) => {
      return res.status(500).json({
        success: 0,
        message:err.message,
        data:err.data,  
      });
    });
  }

  /**
  * @description Allows user to join a group
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: need to ensure group is public, or member has group add code
  */
  public joinGroup(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, user_id, token) => {
      if(err) {
          res.status(401).json({
          status: 'Token has expired',
          message: 'Your token has expired.'
        });
      } else {
        let group_id = parseInt(req.params.id);
        // TODO: ensure user is not a current member of the group
        toolHelpers.joinGroup(group_id, user_id, function() {
          toolHelpers.getGroupById(group_id)
            .then((group) => {
              res.status(200).json({
                status: 'success',
                token: tokenHelper.encodeToken(user_id),
                group: group
              });
          });
        });
      }
    });
  }

  /**
  * @description Allows user to join a group
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Need to ensure user is member of group, or group is public
  */
  public getGroupMembers(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, user_id, token) => {
      if(err) {
          res.status(401).json({
            status: 'Token has expired',
            message: 'Your token has expired.'
          });
      } else {
        let group_id = parseInt(req.params.id);
        var members = toolHelpers.getGroupMembers(group_id, function(err, members) {
          if(err) {
            res.status(400).json({
              status: 'error',
              message: 'Something went wrong.'
            });
          } else {
            res.status(200).json({
              status: 'success',
              token: tokenHelper.encodeToken(user_id),
              members: members
            });
          }
        });
      }
    });
  }


  /**
  * @description Gets a specific group action (by ID)
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Need to ensure user is member of group, or group is public
  */
  public getGroupAction(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, cur_user_id) => {
      if(err) {
        res.status(400).json({
          status: 'error',
          message: 'Something went wrong.'
        });
      } else {
        let group_id = parseInt(req.params.id);
        let action_id = parseInt(req.params.action_id);
        toolHelpers.getActionById(action_id, group_id)
        .then((action) => {
          res.status(200).json({
            status: 'success',
            token: tokenHelper.encodeToken(cur_user_id),
            action: action
          });
        })
        .catch((err) => {
          console.log(util.inspect(err));
          res.status(401).json({
            status: 'error',
            message: 'Something went wrong, and we didn\'t retreive the action. :('
          });
        });
      }
    });
  }

  /**
  * @description adds record to mark an action as complete
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Make sure user is member of the group
  */
  public markGroupActionComplete(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, cur_user_id) => {
      if(err) {
        res.status(400).json({
          status: 'error',
          message: 'Something went wrong.'
        });
      } else {
        let group_id = parseInt(req.params.id);
        let action_id = parseInt(req.params.action_id);
        toolHelpers.createActionUser(action_id, cur_user_id)
        .then((action) => {
          res.status(200).json({
            status: 'success',
            token: tokenHelper.encodeToken(cur_user_id)
          });
        })
        .catch((err) => {
          console.log(util.inspect(err));
          res.status(401).json({
            status: 'error',
            message: 'Something went wrong, and we didn\'t retreive the action. :('
          });
        });
      }
    });
  }

  /**
  * @description returns an array of supported action types
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  */
  public getActionTypes(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, cur_user_id) => {
      if(err) {
        res.status(400).json({
          status: 'error',
          message: 'Something went wrong.'
        });
      } else {
        toolHelpers.getActionTypes()
        .then((action_types) => {
          res.status(200).json({
            status: 'success',
            token: tokenHelper.encodeToken(cur_user_id),
            action_types: action_types
          });
        })
        .catch((err) => {
          console.log(util.inspect(err));
          res.status(401).json({
            status: 'error',
            message: 'Something went wrong, and we didn\'t retreive the action types. :('
          });
        });
      }
    });
  }

  /**
  * @description sets the deleted_at flag for the specified group
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Make sure user has rights to delete the action (owner, admin)
  */
  public deleteGroupAction(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, cur_user_id) => {
      if(err) {
        res.status(400).json({
          status: 'error',
          message: 'Something went wrong.'
        });
      } else {
        let group_id = parseInt(req.params.id);
        let action_id = parseInt(req.params.action_id);
        toolHelpers.getActionById(action_id, group_id).then((action) => {
          toolHelpers.deleteAction(action_id, cur_user_id)
          .then((result) => {
            res.status(200).json({
              status: 'success',
              token: tokenHelper.encodeToken(cur_user_id),
              REMOVED: action
            });
          })
          .catch((err) => {
            console.log(util.inspect(err));
            res.status(401).json({
              status: 'error',
              message: 'Something went wrong, and we didn\'t retreive the action types. :('
            });
          });
        });
      }
    });
  }

  /**
  * @description updates the details of an action
  * @param Request
  * @param Response
  * @param Callback function (NextFunction)
  * TODO: Make sure user has rights to update the action (owner, admin)
  * TODO: Make sure only updateable fields are on res.body
  */
  public updateGroupAction(req: Request, res: Response, next: NextFunction) {
    tokenHelper.getUserIdFromRequest(req, (err, cur_user_id) => {
      if(err) {
        res.status(400).json({
          status: 'error',
          message: 'Something went wrong.'
        });
      } else {
        let group_id = parseInt(req.params.id);
        let action_id = parseInt(req.params.action_id);
        toolHelpers.updateAction(action_id, req.body)
        .then((count) => {
          toolHelpers.getActionById(action_id, group_id)
          .then((action) => {
            res.status(200).json({
              status: 'success',
              token: tokenHelper.encodeToken(cur_user_id),
              action: action
            });
          });
        })
        .catch((err) => {
          console.log(util.inspect(err));
          res.status(401).json({
            status: 'error',
            message: 'Something went wrong, and we didn\'t retreive the action. :('
          });
        });
      }
    });
  }


  /**
   * Take each handler, and attach to one of the Express.Router's
   * endpoints.
   */
  init() {
    this.router.get('/', 
                    groupHelper.publicGroups,
                    validate(GroupValidation.getPublicGroups),
                    this.getPublicGroups);
    this.router.post('/', 
                    toolHelpers.ensureAuthenticated, 
                    validate(GroupValidation.createGroup),
                    this.createGroup);
    this.router.get('/:group_id', 
                    validate(GroupValidation.getGroup),
                    groupHelper.checkGroup,
                    this.getGroup);
    this.router.put('/:group_id', 
                    validate(GroupValidation.putGroup),
                    toolHelpers.ensureAuthenticated, 
                    groupHelper.checkGroup,
                    this.putGroup);
      // this.router.get('/:id/members', this.getGroupMembers);
      // this.router.post('/:id/members', this.joinGroup);
      // this.router.put('/:id/members/:user_id', this.updateGroupMember);
      // this.router.get('/:id/actions/types', this.getActionTypes);
    this.router.get('/:group_id/actions', 
                    toolHelpers.ensureAuthenticated,
                    validate(GroupValidation.getGroupActions),
                    groupHelper.checkGroup,
                    groupHelper.checkUserPermissionAccessGroup,
                    this.getGroupActions);
    this.router.post('/:group_id/actions', 
                    toolHelpers.ensureAuthenticated,
                    validate(GroupValidation.createGroupAction),
                    groupHelper.checkGroup,
                    groupHelper.checkActionType,
                    groupHelper.checkUserBelongsToGroup,
                    groupHelper.checkUserPermissionModifyGroupActions,
                    this.createGroupAction);
      // this.router.get('/:id/actions/:action_id', this.getGroupAction);
      // this.router.put('/:id/actions/:action_id', this.updateGroupAction);
      // this.router.delete('/:id/actions/:action_id', this.deleteGroupAction);
      // this.router.post('/:id/actions/:action_id/complete', this.markGroupActionComplete);
  }
}



// Create the GroupRouter, and export its configured Express.Router
const groupRoutes = new GroupRouter();
groupRoutes.init();

export default groupRoutes.router;
